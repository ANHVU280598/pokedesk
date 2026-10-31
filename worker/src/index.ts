import { EMPLOYEES } from "@pulse/shared";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createClaude, PREFERRED_MODEL } from "./claude";
import type { Env } from "./env";
import { loadMarket } from "./market";
import { runPipeline } from "./orchestrator";
import { preparePublish } from "./publish";
import { createD1Store } from "./store";
import { hasPrediction } from "./victor";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/team", (c) => c.json({
  employees: EMPLOYEES.map(({ id, name, role, color, station, traits, quote }) => ({
    id, name, role, color, station, traits, quote,
  })),
}));

app.get("/api/events", async (c) => {
  const runId = c.req.query("runId") ?? "";
  if (!runId) return c.json({ ok: false, error: "runId is required" }, 400);
  const events = await createD1Store(c.env.DB).listEvents(runId, c.req.query("after") ?? undefined);
  return c.json({ ok: true, events });
});

app.get("/api/runs/:id", async (c) => {
  const run = await createD1Store(c.env.DB).getRun(c.req.param("id"));
  if (!run) return c.json({ ok: false, error: "Run not found" }, 404);
  return c.json({ ok: true, run });
});

app.get("/api/issues/latest", async (c) => {
  const issue = await createD1Store(c.env.DB).latestIssue(c.req.query("public") === "1");
  return c.json({ ok: true, issue });
});

app.get("/api/issues/:id", async (c) => {
  const issue = await createD1Store(c.env.DB).getIssue(c.req.param("id"));
  if (!issue) return c.json({ ok: false, error: "Issue not found" }, 404);
  return c.json({ ok: true, issue });
});

app.post("/api/test/rex", async (c) => {
  if (await rejectOwner(c)) return c.json({ ok: false, error: "Unauthorized" }, 401);
  try {
    const market = await loadMarket();
    const claude = createClaude(c.env.ANTHROPIC_API_KEY ?? "", c.env.CLAUDE_MODEL || PREFERRED_MODEL);
    const result = await claude({
      label: "rex",
      system: "Pick 3 symbols from the list. Return JSON {\"items\":[{\"symbol\":\"btc\",\"why\":\"neutral sentence\"}]}. No price predictions.",
      user: market.coins.slice(0, 12).map((coin) => `${coin.symbol} ${coin.name} ${coin.sourceUrl}`).join("\n"),
      maxTokens: 700,
    });
    return c.json({ ok: true, model: result.model, raw: result.text, market: market.coins.slice(0, 12) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rex could not finish.";
    return c.json({ ok: false, error: message }, 503);
  }
});

app.post("/api/run", async (c) => {
  if (await rejectOwner(c)) return c.json({ ok: false, error: "Unauthorized" }, 401);
  return jsonRun(c, "manual", c.req.header("x-run-sync") === "1");
});

app.patch("/api/issues/:id", async (c) => {
  if (await rejectOwner(c)) return c.json({ ok: false, error: "Unauthorized" }, 401);
  const body = await c.req.json<{ subject?: string; body?: string }>();
  const store = createD1Store(c.env.DB);
  const current = await store.getIssue(c.req.param("id"));
  if (!current) return c.json({ ok: false, error: "Issue not found" }, 404);
  if (current.status !== "pending_approval") return c.json({ ok: false, error: "Only a pending issue can be edited" }, 409);
  if ((body.subject && hasPrediction(body.subject)) || (body.body && hasPrediction(body.body))) {
    return c.json({ ok: false, error: "Victor rejected a price prediction." }, 422);
  }
  const subject = body.subject ?? current.subject;
  const nextBody = body.body ?? current.body;
  const issue = await store.updateIssue(current.id, { subject, body: nextBody, updatedAt: Date.now() });
  return c.json({ ok: true, issue });
});

app.post("/api/issues/:id/approve", async (c) => {
  if (await rejectOwner(c)) return c.json({ ok: false, error: "Unauthorized" }, 401);
  const store = createD1Store(c.env.DB);
  const current = await store.getIssue(c.req.param("id"));
  if (!current) return c.json({ ok: false, error: "Issue not found" }, 404);
  if (hasPrediction(current.subject) || hasPrediction(current.body)) {
    return c.json({ ok: false, error: "Victor rejected a price prediction." }, 422);
  }
  const issue = await store.updateIssue(current.id, { status: "approved", updatedAt: Date.now() });
  return c.json({ ok: true, issue, sent: false });
});

app.post("/api/issues/:id/publish", async (c) => {
  if (await rejectOwner(c)) return c.json({ ok: false, error: "Unauthorized" }, 401);
  const issue = await createD1Store(c.env.DB).getIssue(c.req.param("id"));
  if (!issue) return c.json({ ok: false, error: "Issue not found" }, 404);
  if (issue.status !== "approved") return c.json({ ok: false, error: "Approve the issue before preparing a publish." }, 409);
  return c.json({ ok: true, plan: preparePublish(issue, c.env) });
});

async function jsonRun(c: Context<{ Bindings: Env }>, source: "manual" | "cron", sync: boolean): Promise<Response> {
  const store = createD1Store(c.env.DB);
  const limit = Number(c.env.DAILY_TOKEN_BUDGET || "20000") || 20000;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (await store.dayTokens(day) >= limit) {
    return c.json({ ok: false, error: "Daily token budget reached. The run stopped and nothing was sent." }, 429);
  }
  const runId = crypto.randomUUID();
  const locked = await store.tryLock(runId, now, now + 15 * 60 * 1000);
  if (!locked) return c.json({ ok: false, error: "A run is already active." }, 409);
  await store.createRun({ id: runId, source, startedAt: now });
  const job = runPipeline({
    store,
    runId,
    source,
    now,
    budgetLimit: limit,
    loadMarket: () => loadMarket(),
    claude: createClaude(c.env.ANTHROPIC_API_KEY ?? "", c.env.CLAUDE_MODEL || PREFERRED_MODEL),
  }).finally(() => store.releaseLock(runId));
  if (sync) {
    const result = await job;
    const issue = result.ok ? result.issue : null;
    return c.json({ ...result, runId, issue }, result.ok ? 200 : 503);
  }
  c.executionCtx.waitUntil(job);
  return c.json({ ok: true, runId, status: "running" });
}

async function rejectOwner(c: { env: Env; req: { header: (name: string) => string | undefined } }): Promise<boolean> {
  const expected = c.env.OWNER_TOKEN ?? "";
  const sent = c.req.header("x-owner-token") ?? "";
  if (!expected || !sent || expected.length !== sent.length) return true;
  const enc = new TextEncoder();
  return !crypto.subtle.timingSafeEqual(enc.encode(sent), enc.encode(expected));
}

export async function startScheduled(env: Env): Promise<void> {
  const store = createD1Store(env.DB);
  const limit = Number(env.DAILY_TOKEN_BUDGET || "20000") || 20000;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (await store.dayTokens(day) >= limit) return;
  const runId = crypto.randomUUID();
  if (!(await store.tryLock(runId, now, now + 15 * 60 * 1000))) return;
  await store.createRun({ id: runId, source: "cron", startedAt: now });
  await runPipeline({
    store,
    runId,
    source: "cron",
    now,
    budgetLimit: limit,
    loadMarket: () => loadMarket(),
    claude: createClaude(env.ANTHROPIC_API_KEY ?? "", env.CLAUDE_MODEL || PREFERRED_MODEL),
  }).finally(() => store.releaseLock(runId));
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(startScheduled(env));
  },
};
