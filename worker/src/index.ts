import { Hono } from "hono";

export type Env = {
  DB: D1Database;
  KV: KVNamespace;
  ANTHROPIC_API_KEY?: string;
  OWNER_TOKEN?: string;
  DAILY_TOKEN_BUDGET?: string;
  ENVIRONMENT?: string;
  CLAUDE_MODEL?: string;
  BEEHIIV_API_KEY?: string;
  BEEHIIV_PUBLICATION_ID?: string;
  X_API_KEY?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
