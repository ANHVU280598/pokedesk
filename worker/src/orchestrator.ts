import type { AffiliateBlock, Issue, WorkEvent } from "@pulse/shared";
import { z } from "zod";
import type { ClaudeClient, ClaudeResult } from "./claude";
import { parseModelJson } from "./claude";
import type { CoinFact, MarketSnapshot } from "./market";
import { PROMPTS } from "./prompts";
import type { Store } from "./store";
import { assertNeutral, hasPrediction, PREDICTION_NOTE, reviewDraft } from "./victor";

const rexSchema = z.object({
  items: z.array(z.object({ symbol: z.string().min(1), why: z.string().min(1) })).length(3),
});
const lunaSchema = z.object({
  sections: z.array(z.object({ heading: z.string().min(1), text: z.string().min(1) })).min(2).max(4),
});
const victorSchema = z.object({
  summary: z.string().min(1),
  body: z.string().min(1),
});
const ivySchema = z.object({
  subject: z.string().min(1).max(140),
  preheader: z.string().min(1).max(180),
});

export const FOOTER = [
  "Advertising",
  "[Ad slot] Your ad network unit goes here. No ad script is loaded.",
  "",
  "Affiliate disclosure",
  "Some links below are affiliate placeholders. We may earn a commission if a real program replaces them. They are not endorsements.",
  "",
  "Not financial advice. This newsletter is information, not a recommendation to buy or sell anything.",
].join("\n");

export const AFFILIATES: AffiliateBlock[] = [
  {
    label: "Example exchange (placeholder)",
    href: "https://example.com/affiliate/PLACEHOLDER_EXCHANGE",
    disclosure: "Affiliate link. We may earn a commission. This placeholder is not a live offer.",
  },
  {
    label: "Example wallet (placeholder)",
    href: "https://example.com/affiliate/PLACEHOLDER_WALLET",
    disclosure: "Affiliate link. We may earn a commission. Replace this placeholder before any real campaign.",
  },
];

export type PipelineDeps = {
  store: Store;
  runId: string;
  source: "manual" | "cron";
  now: number;
  budgetLimit: number;
  loadMarket: () => Promise<MarketSnapshot>;
  claude: ClaudeClient;
};

export type PipelineResult =
  | { ok: true; issue: Issue; model: string }
  | { ok: false; error: string };

export async function runPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const day = new Date(deps.now).toISOString().slice(0, 10);
  let tokens = 0;
  let model = "";
  let clock = deps.now;
  let step = "maya";
  const stamp = () => {
    clock += 1;
    return clock;
  };
  const say = async (event: Omit<WorkEvent, "id" | "runId" | "ts">) => {
    await deps.store.addEvent({ ...event, id: crypto.randomUUID(), runId: deps.runId, ts: stamp(), summary: clip(event.summary) });
  };
  const ask = async (label: string, system: string, user: string, maxTokens: number): Promise<ClaudeResult> => {
    const used = await deps.store.dayTokens(day);
    if (used >= deps.budgetLimit) {
      throw new Error("Daily token budget reached. The run stopped and nothing was sent.");
    }
    const result = await deps.claude({ label, system, user, maxTokens });
    tokens += result.inputTokens + result.outputTokens;
    await deps.store.addTokens(day, result.inputTokens + result.outputTokens);
    model = result.model;
    const after = await deps.store.dayTokens(day);
    if (after > deps.budgetLimit) {
      throw new Error("Daily token budget reached. The run stopped and nothing was sent.");
    }
    return result;
  };

  try {
    await say({
      employee: "maya",
      action: "assign",
      summary: "Today's run is set. Rex, pull the market.",
      fullText: "Maya assigned three public market items, a neutral draft, a fact check, and a subject line. Nothing is sent from this run.",
      station: "planning",
      status: "done",
    });

    step = "rex";
    const market = await deps.loadMarket();
    const picked = await ask("rex", PROMPTS.rex, marketPrompt(market), 700);
    const stories = storiesFrom(picked.text, market.coins);
    await say({
      employee: "rex",
      action: "research",
      summary: `Pulled ${stories.map((coin) => coin.name).join(", ")}.`,
      fullText: stories.map((coin) => `${coin.name} (${coin.symbol}): ${coin.why} ${coin.sourceUrl}`).join("\n"),
      station: "data",
      status: "done",
    });

    step = "luna";
    const draft = await ask("luna", PROMPTS.luna, `Notes:\n${stories.map((coin) => `${coin.name}: ${coin.why} Source: ${coin.sourceUrl}`).join("\n")}`, 1200);
    const draftBody = sectionsToText(lunaSchema.parse(parseModelJson(draft.text)).sections);
    await say({
      employee: "luna",
      action: "draft",
      summary: "Drafted a short brief from Rex's notes.",
      fullText: draftBody,
      station: "writing",
      status: "done",
    });

    step = "victor";
    const checked = await ask("victor", PROMPTS.victor, `Draft:\n${draftBody}\n\nSources:\n${stories.map((coin) => coin.sourceUrl).join("\n")}`, 1200);
    const victorJson = victorSchema.parse(parseModelJson(checked.text));
    const reviewed = reviewDraft(`${victorJson.body}\n${draftBody}`);
    const victorSummary = reviewed.removed ? PREDICTION_NOTE : clip(victorJson.summary);
    await say({
      employee: "victor",
      action: "factcheck",
      summary: victorSummary,
      fullText: reviewed.text,
      station: "factcheck",
      status: "done",
    });

    step = "luna";
    const revisedCall = await ask(
      "revise",
      PROMPTS.revise,
      `Fact check: ${victorSummary}\n\nDraft:\n${reviewed.text}`,
      1200,
    );
    const revisedRaw = sectionsToText(lunaSchema.parse(parseModelJson(revisedCall.text)).sections);
    const revised = reviewDraft(revisedRaw);
    await say({
      employee: "luna",
      action: "revise",
      summary: revised.removed ? "Rewrote the flagged line as a plain fact." : "Folded Victor's notes into the draft.",
      fullText: revised.text,
      station: "writing",
      status: "done",
    });

    step = "ivy";
    const growth = await ask("ivy", PROMPTS.ivy, `Newsletter:\n${revised.text}`, 400);
    const ivy = ivySchema.parse(parseModelJson(growth.text));
    const subject = reviewDraft(ivy.subject);
    const preheader = reviewDraft(ivy.preheader);
    await say({
      employee: "ivy",
      action: "monetize",
      summary: clip(subject.text || "Subject line set. Affiliate slots are placeholders."),
      fullText: `Subject: ${subject.text}\nPreheader: ${preheader.text}\n${FOOTER}`,
      station: "growth",
      status: "done",
    });

    const issue: Issue = {
      id: crypto.randomUUID(),
      runId: deps.runId,
      subject: subject.text || "Today's market brief",
      preheader: preheader.text || "A short brief from public market data. Not financial advice.",
      body: revised.text,
      footer: FOOTER,
      sources: stories.map((coin) => ({ title: coin.name, url: coin.sourceUrl })),
      affiliates: AFFILIATES,
      status: "pending_approval",
      createdAt: deps.now,
      updatedAt: deps.now,
    };
    assertNeutral([issue.subject, issue.preheader, issue.body, issue.footer]);
    await deps.store.saveIssue(issue);
    await say({
      employee: "maya",
      action: "finish",
      summary: "The issue is in the outbox, waiting for you.",
      fullText: `Model: ${model || "unspecified"}. Approval does not send the newsletter.`,
      station: "outbox",
      status: "done",
    });
    await deps.store.finishRun(deps.runId, "succeeded", null, tokens, model || null);
    return { ok: true, issue, model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The run stopped and nothing was sent.";
    const safe = message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240);
    const employee = step === "rex" ? "rex" : step === "luna" ? "luna" : step === "victor" ? "victor" : step === "ivy" ? "ivy" : "maya";
    const station = employee === "rex" ? "data" : employee === "luna" ? "writing" : employee === "victor" ? "factcheck" : employee === "ivy" ? "growth" : "planning";
    await say({
      employee,
      action: "error",
      summary: clip(safe),
      fullText: safe,
      station,
      status: "error",
    }).catch(() => undefined);
    await deps.store.finishRun(deps.runId, "failed", safe, tokens, model || null);
    return { ok: false, error: safe };
  }
}

type Story = CoinFact & { why: string };

function storiesFrom(text: string, coins: CoinFact[]): Story[] {
  const parsed = rexSchema.parse(parseModelJson(text));
  return parsed.items.map((item) => {
    const coin = coins.find((entry) => entry.symbol === item.symbol.toLowerCase() || entry.name.toLowerCase() === item.symbol.toLowerCase());
    if (!coin) {
      throw new Error("Claude returned an unknown coin. The run stopped and nothing was sent.");
    }
    const why = reviewDraft(item.why);
    if (hasPrediction(why.text)) {
      throw new Error("Victor rejected a price prediction. The run stopped and nothing was sent.");
    }
    return { ...coin, why: why.text };
  });
}

function sectionsToText(sections: { heading: string; text: string }[]): string {
  return sections.map((section) => `${section.heading}\n${section.text}`).join("\n\n");
}

function marketPrompt(market: MarketSnapshot): string {
  return market.coins
    .slice(0, 12)
    .map((coin) => `${coin.symbol} | ${coin.name} | change24h ${coin.change24h} | volume ${coin.volume} | ${coin.sourceUrl}`)
    .join("\n");
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 90 ? clean : `${clean.slice(0, 87)}...`;
}
