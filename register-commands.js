/**
 * register-commands.js
 *
 * One-time script to register (or overwrite) all global application commands
 * with the Discord API via a bulk PUT request.
 *
 * Usage:
 *   DISCORD_APP_ID=<id> DISCORD_BOT_TOKEN=<token> node register-commands.js
 *
 * Or set the variables in your shell before running:
 *   $env:DISCORD_APP_ID  = "..."   (PowerShell)
 *   $env:DISCORD_BOT_TOKEN = "..."
 *   node register-commands.js
 */

const APP_ID   = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error('ERROR: DISCORD_APP_ID and DISCORD_BOT_TOKEN must be set as environment variables.');
  process.exit(1);
}

/** All commands registered globally for this application. */
const COMMANDS = [
  // ── Slash command: /track ──────────────────────────────────────────────────
  {
    name: 'track',
    description: 'Track a Modrinth project for updates in this channel.',
    type: 1, // CHAT_INPUT
    options: [
      {
        name: 'project',
        description: 'Modrinth project URL or ID/slug  (e.g. https://modrinth.com/mod/sodium  or  sodium)',
        type: 3,     // STRING
        required: true,
      },
    ],
  },

  // ── Slash command: /untrack ────────────────────────────────────────────────
  {
    name: 'untrack',
    description: 'Stop tracking a Modrinth project in this channel.',
    type: 1,
    options: [
      {
        name: 'project',
        description: 'Modrinth project URL or ID/slug',
        type: 3,
        required: true,
      },
    ],
  },

  // ── Message context menu: Apps → "Link Modrinth Project" ──────────────────
  // Right-click any message that contains a modrinth.com URL to track it.
  {
    name: 'Link Modrinth Project',
    type: 3, // MESSAGE context menu
  },
];

async function registerCommands() {
  const endpoint = `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization:  `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(COMMANDS),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed to register commands (HTTP ${res.status}):\n${body}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`Successfully registered ${data.length} command(s):`);
  for (const cmd of data) {
    const type = cmd.type === 1 ? 'CHAT_INPUT' : cmd.type === 2 ? 'USER' : 'MESSAGE';
    console.log(`  [${type}] ${cmd.name}  (id: ${cmd.id})`);
  }
}

registerCommands();
