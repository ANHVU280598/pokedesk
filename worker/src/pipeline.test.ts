import { describe, expect, it } from "vitest";
import type { ClaudeClient } from "./claude";
import type { MarketSnapshot } from "./market";
import { AFFILIATES, runPipeline } from "./orchestrator";
import { preparePublish } from "./publish";
import { createMemoryStore } from "./store";
import { hasPrediction, reviewDraft } from "./victor";

const market: MarketSnapshot = {
  coins: [
    { id: "bitcoin", name: "Bitcoin", symbol: "btc", change24h: 1.2, volume: 100, sourceUrl: "https://www.coingecko.com/en/coins/bitcoin" },
    { id: "ethereum", name: "Ethereum", symbol: "eth", change24h: -0.4, volume: 80, sourceUrl: "https://www.coingecko.com/en/coins/ethereum" },
    { id: "solana", name: "Solana", symbol: "sol", change24h: 3.1, volume: 40, sourceUrl: "https://www.coingecko.com/en/coins/solana" },
  ],
};

function scripted(map: Record<string, string>, calls: { n: number }): ClaudeClient {
  return async (request) => {
    calls.n += 1;
    const text = map[request.label];
    if (!text) throw new Error("Claude is unavailable. The run stopped and nothing was sent.");
    return { text, model: "claude-haiku-5-5", inputTokens: 10, outputTokens: 15 };
  };
}

describe("Victor", () => {
  it("rejects a draft that says a coin will 10x", () => {
    const reviewed = reviewDraft("Bitcoin volume rose. This coin will 10x by Friday.");
    expect(reviewed.removed).toBe(true);
    expect(reviewed.text.toLowerCase()).not.toContain("10x");
    expect(hasPrediction(reviewed.text)).toBe(false);
    expect(hasPrediction("this coin will 10x")).toBe(true);
  });
});

describe("pipeline", () => {
  it("strips a 10x line even when the model keeps it", async () => {
    const store = createMemoryStore();
    const calls = { n: 0 };
    await store.createRun({ id: "run-1", source: "manual", startedAt: 1 });
    const result = await runPipeline({
      store,
      runId: "run-1",
      source: "manual",
      now: 1_700_000_000_000,
      budgetLimit: 20000,
      loadMarket: async () => market,
      claude: scripted({
        rex: JSON.stringify({ items: [
          { symbol: "btc", why: "Bitcoin led public volume." },
          { symbol: "eth", why: "Ether's listed change was small." },
          { symbol: "sol", why: "This coin will 10x." },
        ] }),
        luna: JSON.stringify({ sections: [
          { heading: "Volume", text: "Bitcoin led the public volume list." },
          { heading: "Guess", text: "This coin will 10x if you buy now." },
        ] }),
        victor: JSON.stringify({ summary: "Looks fine.", body: "Solana will 10x. Bitcoin volume was high." }),
        revise: JSON.stringify({ sections: [
          { heading: "Volume", text: "Bitcoin led public dollar volume." },
          { heading: "Ether", text: "Ether's 24-hour change was listed beside it." },
        ] }),
        ivy: JSON.stringify({ subject: "Bitcoin led volume", preheader: "A neutral brief. Not financial advice." }),
      }, calls),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issue.body.toLowerCase()).not.toContain("10x");
    expect(result.issue.subject.toLowerCase()).not.toContain("10x");
    expect(result.issue.status).toBe("pending_approval");
    expect(result.issue.affiliates).toEqual(AFFILIATES);
    const events = await store.listEvents("run-1");
    expect(events.map((event) => event.action)).toEqual(["assign", "research", "draft", "factcheck", "revise", "monetize", "finish"]);
    expect(events.some((event) => event.summary.includes("Removed a price prediction"))).toBe(true);
    expect(calls.n).toBe(5);
  });

  it("fails safely when CoinGecko is down", async () => {
    const store = createMemoryStore();
    const calls = { n: 0 };
    await store.createRun({ id: "run-2", source: "manual", startedAt: 1 });
    const result = await runPipeline({
      store,
      runId: "run-2",
      source: "manual",
      now: 1,
      budgetLimit: 20000,
      loadMarket: async () => {
        throw new Error("CoinGecko is unavailable. The run stopped and nothing was sent.");
      },
      claude: scripted({}, calls),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/CoinGecko/);
    expect(await store.latestIssue(false)).toBeNull();
    expect(calls.n).toBe(0);
    const run = await store.getRun("run-2");
    expect(run?.status).toBe("failed");
  });

  it("stops when the daily token budget is spent", async () => {
    const store = createMemoryStore();
    const calls = { n: 0 };
    await store.addTokens("2023-11-14", 20000);
    await store.createRun({ id: "run-3", source: "manual", startedAt: Date.parse("2023-11-14T12:00:00Z") });
    const result = await runPipeline({
      store,
      runId: "run-3",
      source: "manual",
      now: Date.parse("2023-11-14T12:00:00Z"),
      budgetLimit: 20000,
      loadMarket: async () => market,
      claude: scripted({ rex: "{}" }, calls),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/budget/);
    expect(calls.n).toBe(0);
  });

  it("fails safely when Claude is down", async () => {
    const store = createMemoryStore();
    await store.createRun({ id: "run-4", source: "manual", startedAt: 10 });
    const result = await runPipeline({
      store,
      runId: "run-4",
      source: "manual",
      now: 10,
      budgetLimit: 20000,
      loadMarket: async () => market,
      claude: async () => {
        throw new Error("Claude is unavailable. The run stopped and nothing was sent.");
      },
    });
    expect(result.ok).toBe(false);
    expect(await store.latestIssue(false)).toBeNull();
  });
});

describe("publish", () => {
  it("never marks a channel as sent", () => {
    const plan = preparePublish({
      id: "i",
      runId: "r",
      subject: "Hello",
      preheader: "Pre",
      body: "Body",
      footer: "Not financial advice.",
      sources: [],
      affiliates: AFFILIATES,
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    }, {});
    expect(plan.liveSend).toBe(false);
    expect(plan.channels.every((channel) => channel.sent === false)).toBe(true);
  });
});
