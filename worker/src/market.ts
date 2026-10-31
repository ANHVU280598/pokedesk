export type CoinFact = {
  id: string;
  name: string;
  symbol: string;
  change24h: number;
  volume: number;
  sourceUrl: string;
};

export type MarketSnapshot = {
  coins: CoinFact[];
  fetchedAt: number;
};

const TRENDING = "https://api.coingecko.com/api/v3/search/trending";
const MARKETS =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=15&page=1&price_change_percentage=24h";

export async function loadMarket(fetchImpl: typeof fetch = fetch): Promise<MarketSnapshot> {
  const [trendingResponse, marketResponse] = await Promise.all([
    fetchImpl(TRENDING, { headers: { accept: "application/json", "user-agent": "PulseDesk/0.1" }, signal: AbortSignal.timeout(12000) }),
    fetchImpl(MARKETS, { headers: { accept: "application/json", "user-agent": "PulseDesk/0.1" }, signal: AbortSignal.timeout(12000) }),
  ]);
  if (!trendingResponse.ok || !marketResponse.ok) {
    throw new Error("CoinGecko is unavailable. The run stopped and nothing was sent.");
  }
  const trending = (await trendingResponse.json()) as {
    coins?: { item?: { id?: string; name?: string; symbol?: string; data?: { price_change_percentage_24h?: { usd?: number } } } }[];
  };
  const markets = (await marketResponse.json()) as {
    id?: string;
    name?: string;
    symbol?: string;
    total_volume?: number;
    price_change_percentage_24h?: number;
  }[];
  if (!Array.isArray(markets) || markets.length === 0) {
    throw new Error("CoinGecko is unavailable. The run stopped and nothing was sent.");
  }
  const byId = new Map<string, CoinFact>();
  for (const row of markets) {
    if (!row.id || !row.name || !row.symbol) continue;
    byId.set(row.id, fact(row.id, row.name, row.symbol, row.price_change_percentage_24h ?? 0, row.total_volume ?? 0));
  }
  for (const entry of trending.coins ?? []) {
    const item = entry.item;
    if (!item?.id || !item.name || !item.symbol || byId.has(item.id)) continue;
    const change = item.data?.price_change_percentage_24h?.usd ?? 0;
    byId.set(item.id, fact(item.id, item.name, item.symbol, change, 0));
  }
  const coins = [...byId.values()];
  if (coins.length < 3) {
    throw new Error("CoinGecko is unavailable. The run stopped and nothing was sent.");
  }
  return { coins, fetchedAt: Date.now() };
}

function fact(id: string, name: string, symbol: string, change24h: number, volume: number): CoinFact {
  return {
    id,
    name,
    symbol: symbol.toLowerCase(),
    change24h: Number(change24h) || 0,
    volume: Number(volume) || 0,
    sourceUrl: `https://www.coingecko.com/en/coins/${id}`,
  };
}
