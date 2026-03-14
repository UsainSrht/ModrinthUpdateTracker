# Contributing

Thank you for contributing.

## Ground rules

- Keep changes focused and small.
- Do not commit secrets, tokens, or private IDs.
- Document behavior changes in pull requests.
- Prefer readable code over clever code.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure Cloudflare D1 and update [wrangler.toml](wrangler.toml).

3. Apply database schema:

```bash
npm run schema:local
npm run schema:remote
```

4. Set required secrets via Wrangler:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APP_ID
```

5. Run local development server:

```bash
npm run dev
```

## Coding expectations

- Keep compatibility with Cloudflare Workers runtime.
- Handle external API failures gracefully.
- Avoid breaking command payload contracts with Discord.

## Pull request checklist

- Code builds and runs locally.
- No secrets are added.
- README/docs updated if behavior changed.
- Changes are scoped to the problem.

## Reporting issues

Please include:

- What you expected.
- What happened.
- Steps to reproduce.
- Relevant logs or response bodies (without secrets).
