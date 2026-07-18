import type { VercelRequest, VercelResponse } from '@vercel/node';

// Mirrors the native stock_price plugin's locals shape (usetrmnl/plugins
// lib/stock_price/stock_price.rb) so this can be contributed upstream later.
interface Ticker {
  symbol: string;
  name: string;
  price: number;
  change: string; // "1.24%" / "-0.85%" / "" on failure — matches native
}

interface StocksResponse {
  tickers: Ticker[];
  currency_symbol: string;
  currency_separator: string;
}

const MAX_TICKERS = 12; // native plugin's STOCK_TICKER_LIMIT
const DEFAULT_SYMBOLS = ['^NSEI', '^BSESN', 'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS'];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Native plugin's invalid-symbol shape
const invalid = (symbol: string): Ticker => ({
  symbol,
  name: 'SYMBOL_NOT_SUPPORTED',
  price: 0,
  change: '',
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tickerFromMeta(symbol: string, meta: any): Ticker {
  const price = meta?.regularMarketPrice;
  const prev = meta?.chartPreviousClose;
  if (typeof price !== 'number' || typeof prev !== 'number' || prev === 0) {
    return invalid(symbol);
  }
  const pct = ((price - prev) / prev) * 100;
  return {
    symbol,
    name: meta.longName ?? meta.shortName ?? symbol, // indices often lack longName
    price: Math.round(price * 100) / 100,
    change: `${pct.toFixed(2)}%`,
  };
}

// Yahoo aggressively 429s concurrent bursts, so symbols are fetched
// sequentially with one query2-mirror retry on rate limit.
async function fetchTicker(symbol: string): Promise<Ticker> {
  // Numeric BSE codes (e.g. 500325.BO) return stale/broken data from Yahoo —
  // only name-form .BO symbols (RELIANCE.BO) are supported.
  if (/^\d+\.BO$/i.test(symbol)) return invalid(symbol);

  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    const resp = await fetch(`https://${host}${path}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(4000),
    });
    if (resp.status === 429) {
      await sleep(500); // brief backoff, then retry on the mirror host
      continue;
    }
    if (!resp.ok) return invalid(symbol);

    const body: any = await resp.json();
    const meta = body?.chart?.result?.[0]?.meta;
    if (body?.chart?.error || !meta) return invalid(symbol);
    return tickerFromMeta(symbol, meta);
  }
  return invalid(symbol);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const symbols = (raw ? raw.split(',') : DEFAULT_SYMBOLS)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_TICKERS);

  // Sequential to avoid Yahoo's burst rate limiting; deadline keeps the
  // worst case (retries/timeouts on every symbol) inside Vercel's 10s budget.
  const deadline = Date.now() + 8000;
  const tickers: Ticker[] = [];
  for (const symbol of symbols) {
    if (Date.now() > deadline) {
      tickers.push(invalid(symbol));
      continue;
    }
    tickers.push(await fetchTicker(symbol).catch(() => invalid(symbol)));
  }

  // Shield Yahoo from aggressive re-polls via Vercel's CDN cache
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const payload: StocksResponse = {
    tickers,
    currency_symbol: '₹',
    currency_separator: '.',
  };
  res.status(200).json(payload);
}
