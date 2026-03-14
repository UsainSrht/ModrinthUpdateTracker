/**
 * src/index.js  —  Modrinth Update Tracker  (Cloudflare Worker)
 *
 * Handles two entry-points:
 *   fetch()     – Discord HTTP interaction endpoint (slash commands + context menu)
 *   scheduled() – Cron trigger that polls Modrinth and dispatches Discord embeds
 *
 * Required Worker secrets (set via `npx wrangler secret put <NAME>`):
 *   DISCORD_BOT_TOKEN   – Bot token from the Discord Developer Portal
 *   DISCORD_PUBLIC_KEY  – Ed25519 public key for signature verification
 *   DISCORD_APP_ID      – Application / client ID
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const MODRINTH_API  = 'https://api.modrinth.com/v2';
const DISCORD_API   = 'https://discord.com/api/v10';
const MODRINTH_UA   = 'ModrinthUpdateTracker/1.0 (+https://modrinth-tracker.usainsrht.workers.dev)';
const MODRINTH_GREEN = 0x1bd96a;

// Discord interaction types
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
// Discord interaction callback types
const CallbackType = { PONG: 1, CHANNEL_MESSAGE: 4 };
// Message flags
const Flags = { EPHEMERAL: 64 };

// ─── Native Ed25519 signature verification (Web Crypto API) ─────────────────────

/** Converts a hex string to a Uint8Array. */
function hexToUint8Array(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

/**
 * Verifies a Discord Ed25519 request signature using the Web Crypto API.
 * This works natively in the Cloudflare Workers runtime without any npm dependencies.
 */
async function verifyDiscordSignature(publicKeyHex, rawBody, signature, timestamp) {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(publicKeyHex),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToUint8Array(signature),
      new TextEncoder().encode(timestamp + rawBody),
    );
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the project slug/id from a full Modrinth URL or returns the raw
 * input if it already looks like a slug/id.
 *
 * Supports paths like:
 *   https://modrinth.com/mod/sodium
 *   https://modrinth.com/plugin/essentialsx
 *   https://modrinth.com/datapack/terralith
 *   sodium                          (direct slug)
 *   AANobbMI                        (direct id)
 */
function extractProjectId(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'modrinth.com') {
      // Pathname: /mod/sodium  →  ['', 'mod', 'sodium']
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return parts[1];
    }
  } catch {
    // Not a URL – fall through and return the raw string.
  }
  return trimmed;
}

/** Fetch a project object from the Modrinth API. Returns null on failure. */
async function modrinthGetProject(projectId) {
  const res = await fetch(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`, {
    headers: { 'User-Agent': MODRINTH_UA },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Fetch the version list for a project. Returns null on failure. */
async function modrinthGetVersions(projectId) {
  const res = await fetch(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`, {
    headers: { 'User-Agent': MODRINTH_UA },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Computes the added / removed diff between two string arrays and returns a
 * human-readable string, e.g.  "Added: Fabric  |  Removed: Forge"
 */
function arrayDiff(oldArr = [], newArr = []) {
  const added   = newArr.filter(x => !oldArr.includes(x));
  const removed = oldArr.filter(x => !newArr.includes(x));
  const parts   = [];
  if (added.length)   parts.push(`Added: ${added.join(', ')}`);
  if (removed.length) parts.push(`Removed: ${removed.join(', ')}`);
  return parts.length ? parts.join('  |  ') : newArr.join(', ') || 'None';
}

/** Sends a message to a Discord channel using the bot token. */
async function discordSendMessage(channelId, payload, botToken) {
  return fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization:  `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

/** Builds a JSON response for a Discord interaction. */
function interactionResponse(content, ephemeral = false) {
  return Response.json({
    type: CallbackType.CHANNEL_MESSAGE,
    data: {
      content,
      ...(ephemeral ? { flags: Flags.EPHEMERAL } : {}),
    },
  });
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

/**
 * /track <project>
 * Resolves the project, then upserts a row into the D1 subscriptions table.
 */
async function handleTrack(interaction, env) {
  const channelId    = interaction.channel_id;
  const projectInput = interaction.data.options?.[0]?.value ?? '';
  const projectId    = extractProjectId(projectInput);

  if (!projectId) {
    return interactionResponse('Please provide a valid Modrinth project URL or slug.', true);
  }

  const [project, versions] = await Promise.all([
    modrinthGetProject(projectId),
    modrinthGetVersions(projectId),
  ]);

  if (!project) {
    return interactionResponse(
      `Could not find a Modrinth project matching \`${projectInput}\`. ` +
      'Check the URL or slug and try again.',
      true,
    );
  }

  const latestVersionId = Array.isArray(versions) && versions.length > 0
    ? versions[0].id
    : null;

  await env.DB
    .prepare(
      'INSERT OR REPLACE INTO subscriptions (channel_id, project_id, latest_version_id) VALUES (?, ?, ?)',
    )
    .bind(channelId, project.id, latestVersionId)
    .run();

  return interactionResponse(
    `Now tracking **${project.title}** in this channel.\n` +
    `Latest version on record: \`${latestVersionId ?? 'none'}\``,
  );
}

/**
 * /untrack <project>
 * Removes the subscription for this channel + project pair.
 */
async function handleUntrack(interaction, env) {
  const channelId    = interaction.channel_id;
  const projectInput = interaction.data.options?.[0]?.value ?? '';
  const projectId    = extractProjectId(projectInput);

  if (!projectId) {
    return interactionResponse('Please provide a valid Modrinth project URL or slug.', true);
  }

  // Resolve the canonical project.id even if a slug was provided.
  const project = await modrinthGetProject(projectId);
  const canonicalId = project?.id ?? projectId;

  const { meta } = await env.DB
    .prepare('DELETE FROM subscriptions WHERE channel_id = ? AND project_id = ?')
    .bind(channelId, canonicalId)
    .run();

  if (meta.changes === 0) {
    return interactionResponse(
      `This channel is not tracking \`${canonicalId}\`.`,
      true,
    );
  }

  return interactionResponse(
    `Stopped tracking **${project?.title ?? canonicalId}** in this channel.`,
  );
}

/**
 * Apps → "Link Modrinth Project"  (message context menu, type 3)
 * Scans the target message for a modrinth.com URL and tracks that project.
 */
async function handleContextMenu(interaction, env) {
  const channelId = interaction.channel_id;
  const message   = interaction.data.resolved?.messages?.[interaction.data.target_id];

  if (!message) {
    return interactionResponse('Could not read the target message.', true);
  }

  const MODRINTH_URL_RE =
    /https?:\/\/modrinth\.com\/(?:mod|plugin|resourcepack|shader|datapack|modpack)\/([a-zA-Z0-9_-]+)/;
  const match = message.content.match(MODRINTH_URL_RE);

  if (!match) {
    return interactionResponse(
      'No Modrinth project URL found in that message.\n' +
      'The URL must look like `https://modrinth.com/mod/<slug>`.',
      true,
    );
  }

  const projectSlug = match[1];
  const [project, versions] = await Promise.all([
    modrinthGetProject(projectSlug),
    modrinthGetVersions(projectSlug),
  ]);

  if (!project) {
    return interactionResponse(
      `Could not find a Modrinth project for slug \`${projectSlug}\`.`,
      true,
    );
  }

  const latestVersionId = Array.isArray(versions) && versions.length > 0
    ? versions[0].id
    : null;

  await env.DB
    .prepare(
      'INSERT OR REPLACE INTO subscriptions (channel_id, project_id, latest_version_id) VALUES (?, ?, ?)',
    )
    .bind(channelId, project.id, latestVersionId)
    .run();

  return interactionResponse(
    `Now tracking **${project.title}** in this channel.\n` +
    `Latest version on record: \`${latestVersionId ?? 'none'}\``,
  );
}

// ─── Scheduled Update Checker ─────────────────────────────────────────────────

/**
 * Polls Modrinth for every tracked project and sends a rich embed to each
 * subscribed channel when a new version is detected.
 */
async function checkForUpdates(env) {
  const { results } = await env.DB
    .prepare('SELECT channel_id, project_id, latest_version_id FROM subscriptions')
    .all();

  if (!results || results.length === 0) return;

  // De-duplicate project_id lookups: one Modrinth request per project.
  const projectMap = new Map();
  for (const row of results) {
    if (!projectMap.has(row.project_id)) projectMap.set(row.project_id, []);
    projectMap.get(row.project_id).push(row);
  }

  for (const [projectId, subscriptions] of projectMap) {
    let versions;
    try {
      versions = await modrinthGetVersions(projectId);
    } catch {
      continue; // Skip this project on network error; retry next cron tick.
    }

    if (!Array.isArray(versions) || versions.length === 0) continue;

    const latestVersion   = versions[0];
    const previousVersion = versions[1] ?? null; // May be undefined for brand-new projects.

    for (const sub of subscriptions) {
      if (latestVersion.id === sub.latest_version_id) continue; // No change.

      // ── Resolve project metadata (needed for the embed title) ──────────────
      let projectTitle = projectId;
      try {
        const project = await modrinthGetProject(projectId);
        if (project?.title) projectTitle = project.title;
      } catch { /* non-fatal */ }

      // ── Build loader + game-version diff strings ───────────────────────────
      const loaderDiff = arrayDiff(
        previousVersion?.loaders       ?? [],
        latestVersion.loaders          ?? [],
      );
      const gameVersionDiff = arrayDiff(
        previousVersion?.game_versions ?? [],
        latestVersion.game_versions    ?? [],
      );

      // ── Truncate changelog to Discord embed description limit (4096 chars) ─
      const changelog = (latestVersion.changelog ?? 'No changelog provided.')
        .slice(0, 4096);

      // The primary download URL, falling back to the project version page.
      const downloadUrl =
        latestVersion.files?.[0]?.url ??
        `https://modrinth.com/project/${projectId}/version/${latestVersion.id}`;

      // ── Discord embed object ───────────────────────────────────────────────
      const embed = {
        title:       `${projectTitle} — ${latestVersion.version_number}`,
        description: changelog,
        url:         downloadUrl,
        color:       MODRINTH_GREEN,
        fields: [
          {
            name:   'Loaders',
            value:  loaderDiff,
            inline: true,
          },
          {
            name:   'Game Versions',
            value:  gameVersionDiff,
            inline: true,
          },
        ],
        timestamp: latestVersion.date_published,
        footer:    { text: 'Modrinth Update Tracker' },
      };

      // ── Send the embed to the subscribed Discord channel ───────────────────
      const msgRes = await discordSendMessage(
        sub.channel_id,
        { embeds: [embed] },
        env.DISCORD_BOT_TOKEN,
      );

      if (!msgRes.ok) {
        // Log but don't throw; other subscriptions should still be processed.
        console.error(
          `Failed to send update to channel ${sub.channel_id}: HTTP ${msgRes.status}`,
        );
        continue;
      }

      // ── Persist the new latest_version_id ─────────────────────────────────
      await env.DB
        .prepare(
          'UPDATE subscriptions SET latest_version_id = ? WHERE channel_id = ? AND project_id = ?',
        )
        .bind(latestVersion.id, sub.channel_id, projectId)
        .run();
    }
  }
}

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  // ── HTTP fetch handler (Discord interactions endpoint) ─────────────────────
  async fetch(request, env) {
    if (request.method === 'GET') {
      const { pathname } = new URL(request.url);

      if (pathname === '/health') {
        return new Response('OK: Discord interactions endpoint is live. Use signed POST requests only.', {
          status: 200,
        });
      }

      if (!env.DISCORD_APP_ID) {
        console.error('DISCORD_APP_ID secret is not set in this Worker environment.');
        return new Response('Server configuration error.', { status: 500 });
      }

      const inviteUrl = new URL('https://discord.com/oauth2/authorize');
      inviteUrl.searchParams.set('client_id', env.DISCORD_APP_ID);
      inviteUrl.searchParams.set('scope', 'bot applications.commands');
      inviteUrl.searchParams.set('permissions', '18432');

      return Response.redirect(inviteUrl.toString(), 302);
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (!env.DISCORD_PUBLIC_KEY) {
      console.error('DISCORD_PUBLIC_KEY secret is not set in this Worker environment.');
      return new Response('Server configuration error.', { status: 500 });
    }

    // ── Step 1: Verify Ed25519 signature ─────────────────────────────────────
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');

    if (!signature || !timestamp) {
      return new Response('Missing signature headers.', { status: 401 });
    }

    // Read the raw body once; reuse it for both verification and JSON parsing.
    const rawBody = await request.text();

    const isValid = await verifyDiscordSignature(env.DISCORD_PUBLIC_KEY, rawBody, signature, timestamp);
    if (!isValid) {
      return new Response('Invalid request signature.', { status: 401 });
    }

    // ── Step 2: Route the interaction ─────────────────────────────────────────
    let interaction;
    try {
      interaction = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON body.', { status: 400 });
    }

    // Discord PING (used during Interactions Endpoint URL verification).
    if (interaction.type === InteractionType.PING) {
      return Response.json({ type: CallbackType.PONG });
    }

    // Slash commands and context menu commands.
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const name = interaction.data?.name;

      if (name === 'track')                  return handleTrack(interaction, env);
      if (name === 'untrack')                return handleUntrack(interaction, env);
      if (name === 'Link Modrinth Project')  return handleContextMenu(interaction, env);
    }

    // Unknown interaction type – acknowledge silently.
    return Response.json({ type: CallbackType.PONG });
  },

  // ── Cron-triggered scheduled handler (Modrinth polling) ───────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkForUpdates(env));
  },
};
