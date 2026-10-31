# Pulse Desk

A full-screen low-poly office where five AI employees draft a daily crypto newsletter. You watch the run, then approve it. Nothing is sent on its own.

This repository used to be Catalog Desk. That app has been replaced by this monorepo.

```
/web      Vite + TypeScript + Three.js
/worker   Cloudflare Worker (Hono) + D1
/shared   WorkEvent, Employee, and Issue types
```

## Run locally

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars
cp web/.env.example web/.env.local
npm run dev
```

- Web: http://127.0.0.1:5173
- Worker: http://127.0.0.1:8787
- Health: http://127.0.0.1:8787/api/health → `{ "ok": true }`

The web dev server proxies `/api` to the worker. Put `ANTHROPIC_API_KEY` only in `worker/.dev.vars` (gitignored). The browser bundle must never contain that key.

`OWNER_TOKEN` in local dev is the placeholder `dev-owner`, matched by `VITE_OWNER_TOKEN`. Production tokens are Worker secrets, not files in git. Do not put `VITE_OWNER_TOKEN` in a public Pages build. The public site is the read-only `/demo` page.

Apply the local database before the first run:

```bash
npm run db:migrate -w @pulse/worker
```

The daily cron is `0 6 * * *` UTC. It drafts an issue and waits. It does not send mail or post anywhere.

## Deploy

Wrangler must already be logged in (`npx wrangler login`). This repo does not deploy itself.

From `worker/`:

```bash
npx wrangler d1 create pulse-desk
npx wrangler kv namespace create pulse-desk
```

Copy the printed database id and KV id into `worker/wrangler.toml`. Then:

```bash
npx wrangler d1 migrations apply pulse-desk --remote
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OWNER_TOKEN
npx wrangler secret put BEEHIIV_API_KEY
npx wrangler secret put BEEHIIV_PUBLICATION_ID
npx wrangler secret put X_API_KEY
npx wrangler secret put REDDIT_CLIENT_ID
npx wrangler secret put REDDIT_CLIENT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler deploy
```

Those `secret put` commands read the value from your prompt. Do not paste secrets into the shell history or into git. Beehiiv, X, Reddit, and Telegram stay unwired until you change the code: publish prepares a payload and returns `sent: false`.

Build the site with the worker URL, still without an owner token:

```bash
VITE_API_BASE="https://pulse-desk.<account>.workers.dev" npm run build -w @pulse/web
npx wrangler pages deploy web/dist --project-name pulse-desk
```

Visitors use `https://<pages-domain>/demo`. That page can read an approved issue. It cannot start a run.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Worker and web together |
| `npm run dev:web` | Vite only |
| `npm run dev:worker` | Wrangler only |
| `npm run build` | Typecheck and build the web app |
| `npm test` | Worker tests |
| `npm run db:migrate -w @pulse/worker` | Apply D1 migrations locally |
