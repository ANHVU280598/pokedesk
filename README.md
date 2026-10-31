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

`OWNER_TOKEN` in local dev is the placeholder `dev-owner`, matched by `VITE_OWNER_TOKEN`. Production tokens are Worker secrets, not files in git.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Worker and web together |
| `npm run dev:web` | Vite only |
| `npm run dev:worker` | Wrangler only |
| `npm run build` | Typecheck and build the web app |
| `npm test` | Worker tests |
| `npm run db:migrate -w @pulse/worker` | Apply D1 migrations locally |
