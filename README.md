# Modrinth Update Tracker

A Cloudflare Worker Discord bot that tracks Modrinth project releases and posts update embeds to Discord channels.

## What this bot does

- Tracks Modrinth projects per Discord channel.
- Sends update embeds when a new version is published.
- Supports slash commands (`/track`, `/untrack`) and a message context menu command (`Link Modrinth Project`).
- Runs on Cloudflare Workers with D1 for persistence.

## Tech stack

- Cloudflare Workers
- Cloudflare D1
- Discord Interactions API
- Modrinth API
- Node.js + Wrangler

## Prerequisites

- Node.js 18+ (Node.js 20 recommended)
- A Cloudflare account
- A Discord application and bot
- A server where you can install the bot

## Quick start (self-host your own instance)

1. Install dependencies:

```bash
npm install
```

2. Create a D1 database:

```bash
npx wrangler d1 create modrinth-tracker
```

3. Update [wrangler.toml](wrangler.toml) with your D1 `database_id`.

4. Apply the schema to D1:

```bash
npm run schema:remote
```

5. Set required Worker secrets:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APP_ID
```

6. Register global Discord commands (one-time or when commands change):

PowerShell:

```powershell
$env:DISCORD_APP_ID = "YOUR_APP_ID"
$env:DISCORD_BOT_TOKEN = "YOUR_BOT_TOKEN"
npm run register
```

7. Deploy the Worker:

```bash
npm run deploy
```

8. In the Discord Developer Portal, set the Interactions Endpoint URL to your Worker URL, for example:

```text
https://your-worker-name.your-subdomain.workers.dev
```

## Add the bot to your server

After deployment and setting `DISCORD_APP_ID`, open your Worker URL in a browser. The `GET /` handler redirects to Discord OAuth so you can authorize the bot.

If you prefer a direct link, use:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=18432
```

## Bot usage

- `/track project:<url-or-slug>`: Start tracking a Modrinth project in the current channel.
- `/untrack project:<url-or-slug>`: Stop tracking a project in the current channel.
- `Apps -> Link Modrinth Project` on a message containing a Modrinth URL.

## Local development

Run local Worker dev server:

```bash
npm run dev
```

Apply schema to local D1:

```bash
npm run schema:local
```

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

### Typical contribution flow

1. Fork the repository.
2. Create a branch (`feat/your-change` or `fix/your-change`).
3. Make your change with clear commit messages.
4. Validate locally (`npm run dev` and command registration if needed).
5. Open a pull request with context, screenshots/logs if relevant, and test notes.

## Security notes

- Never commit secrets or tokens.
- Keep bot token and signing keys in Cloudflare secrets, not source files.
- Rotate Discord tokens if they are exposed.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
