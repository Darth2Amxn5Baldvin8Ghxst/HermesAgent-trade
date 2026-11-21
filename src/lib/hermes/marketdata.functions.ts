import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Real, keyless market data. Binance public data API (crypto + PAXG gold token) and Yahoo chart API. */
export type RealBar = { t: number; o: number; h: number; l: number; c: number };

const MIN = 60_000;
const UA = { "User-Agent": "Mozilla/5.0 HermesAgents" };

async function binanceM1(symbol: string, days: number): Promise<RealBar[]> {
  const end = Math.floor(Date.now() / MIN) * MIN;
  let start = end - days * 86_400_000;
  const out: RealBar[] = [];
  while (start < end) {
    const u = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&limit=1000&startTime=${start}`;
    const r = await fetch(u, { headers: UA });
    if (!r.ok) throw new Error(`Binance ${symbol}: HTTP ${r.status}`);
    const rows = (await r.json()) as [number, string, string, string, string][];
    if (!rows.length) break;
    for (const k of rows) out.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
    start = rows[rows.length - 1]![0] + MIN;
    if (rows.length < 1000) break;
  }
  return out;
}

async function yahoo(symbol: string, interval: "1m" | "1d", days: number): Promise<RealBar[]> {
  const out: RealBar[] = [];
  const now = Math.floor(Date.now() / 1000);
  const chunk = interval === "1m" ? 7 * 86400 : days * 86400;
  // Yahoo serves 1m bars for the last ~30 days, max 7 days per request.
  for (let p1 = now - days * 86400; p1 < now; p1 += chunk) {
    const p2 = Math.min(now, p1 + chunk);
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${p1}&period2=${p2}`;
    const r = await fetch(u, { headers: UA });
    if (!r.ok) throw new Error(`Yahoo ${symbol}: HTTP ${r.status}`);
    const j = (await r.json()) as {
      chart: { result?: { timestamp?: number[]; indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[] }[] } }[] };
    };
    const res = j.chart.result?.[0];
    const q = res?.indicators.quote[0];
    if (!res?.timestamp || !q) continue;
    res.timestamp.forEach((ts, i) => {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) return;
      out.push({ t: ts * 1000, o, h, l, c });
    });
  }
  const seen = new Set<number>();
  return out.filter((b) => (seen.has(b.t) ? false : (seen.add(b.t), true))).sort((a, b) => a.t - b.t);
}

export const REAL_FEEDS = {
  "real:paxg": { label: "Real · Gold (PAXG/USDT, Binance) M1", maxDays: 60 },
  "real:gcf": { label: "Real · Gold futures (COMEX GC=F, Yahoo) M1", maxDays: 28 },
} as const;
export type RealFeedId = keyof typeof REAL_FEEDS;

export const fetchRealGoldM1 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ feed: z.enum(["real:paxg", "real:gcf"]), days: z.number().int().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data }) => {
    const days = Math.min(data.days, REAL_FEEDS[data.feed].maxDays);
    const bars = data.feed === "real:paxg" ? await binanceM1("PAXGUSDT", days) : await yahoo("GC=F", "1m", days);
    return { bars, source: REAL_FEEDS[data.feed].label, days };
  });

export const MARKET_UNIVERSE = [
  { sym: "GC=F", name: "Gold futures", cls: "Metals" },
  { sym: "SI=F", name: "Silver futures", cls: "Metals" },
  { sym: "EURUSD=X", name: "EUR/USD", cls: "FX" },
  { sym: "GBPJPY=X", name: "GBP/JPY", cls: "FX" },
  { sym: "DX-Y.NYB", name: "US Dollar Index", cls: "FX" },
  { sym: "^GSPC", name: "S&P 500", cls: "Indices" },
  { sym: "^NDX", name: "Nasdaq 100", cls: "Indices" },
  { sym: "CL=F", name: "WTI crude oil", cls: "Energy" },
  { sym: "^TNX", name: "US 10-year yield", cls: "Rates" },
  { sym: "BTC-USD", name: "Bitcoin", cls: "Crypto" },
  { sym: "ETH-USD", name: "Ether", cls: "Crypto" },
] as const;

/** One year of real daily closes for every market class. Failures are reported per market, never faked. */
export const fetchMarketUniverse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const rows = await Promise.all(
      MARKET_UNIVERSE.map(async (m) => {
        try {
          const bars = await yahoo(m.sym, "1d", 370);
          return { ...m, closes: bars.map((b) => ({ t: b.t, c: b.c })), error: null as string | null };
        } catch (e) {
          return { ...m, closes: [] as { t: number; c: number }[], error: (e as Error).message };
        }
      }),
    );
    return { rows, fetchedAt: Date.now() };
  });
