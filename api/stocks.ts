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

const INDICES: Record<string, string> = {
  '^NSEI': 'NSE:NIFTY',
  '^BSESN': 'BSE:SENSEX',
};

// Watchlists keep Yahoo-style symbols (RELIANCE.NS, ^NSEI) so existing
// polling URLs work; TradingView wants EXCHANGE:NAME. Numeric BSE scrip
// codes (500325.BO) have no name to map, so they stay unsupported.
export function toTradingView(symbol: string): string | null {
  const index = INDICES[symbol.toUpperCase()];
  if (index) return index;
  const match = /^([A-Z][A-Z0-9&-]*)\.(NS|BO)$/i.exec(symbol);
  if (!match) return null;
  return `${match[2].toUpperCase() === 'NS' ? 'NSE' : 'BSE'}:${match[1].toUpperCase()}`;
}

// Yahoo's chart API now 429s every request without a session cookie, so
// quotes come from TradingView's scanner (unofficial, no key) — one batched
// request for the whole watchlist.
async function fetchQuotes(tvSymbols: string[]): Promise<Map<string, any[]>> {
  const quotes = new Map<string, any[]>();
  if (tvSymbols.length === 0) return quotes;

  const resp = await fetch('https://scanner.tradingview.com/india/scan', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbols: { tickers: tvSymbols },
      columns: ['close', 'change', 'description'], // change is % vs prev close
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    console.log(`tradingview ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return quotes;
  }

  const body: any = await resp.json();
  for (const row of body?.data ?? []) quotes.set(row.s, row.d);
  return quotes;
}

function tickerFromQuote(symbol: string, d: any[] | undefined): Ticker {
  const [price, pct, description] = d ?? [];
  if (typeof price !== 'number' || typeof pct !== 'number') return invalid(symbol);
  return {
    symbol,
    name: description || symbol,
    price: Math.round(price * 100) / 100,
    change: `${pct.toFixed(2)}%`,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const symbols = (raw ? raw.split(',') : DEFAULT_SYMBOLS)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_TICKERS);

  const tvSymbols = symbols.map(toTradingView);
  const quotes = await fetchQuotes(
    [...new Set(tvSymbols.filter((s): s is string => s !== null))],
  ).catch((err) => {
    console.log(`tradingview fetch failed: ${err}`);
    return new Map<string, any[]>();
  });
  const tickers = symbols.map((symbol, i) => {
    const tv = tvSymbols[i];
    return tv ? tickerFromQuote(symbol, quotes.get(tv)) : invalid(symbol);
  });

  // Shield the upstream from aggressive re-polls via Vercel's CDN cache
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const payload: StocksResponse = {
    tickers,
    currency_symbol: '₹',
    currency_separator: '.',
  };
  res.status(200).json(payload);
}
