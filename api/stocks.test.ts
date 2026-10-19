import assert from 'node:assert/strict';
import test from 'node:test';
import { default as handler, toTradingView } from './stocks.js';

async function invokeHandler(symbols?: string) {
  let result: any;
  const req = { query: symbols === undefined ? {} : { symbols } };
  const res = {
    setHeader() {},
    status() { return res; },
    json(body: unknown) {
      result = body;
      return body;
    },
  };
  await handler(req as never, res as never);
  return result;
}

function mockFetch(impl: (body: any) => Response) {
  const original = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    return impl(body);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('toTradingView maps Yahoo-style symbols to exchange tickers', () => {
  assert.equal(toTradingView('RELIANCE.NS'), 'NSE:RELIANCE');
  assert.equal(toTradingView('reliance.bo'), 'BSE:RELIANCE');
  assert.equal(toTradingView('^NSEI'), 'NSE:NIFTY');
  assert.equal(toTradingView('^BSESN'), 'BSE:SENSEX');
  assert.equal(toTradingView('500325.BO'), null); // numeric BSE codes unsupported
  assert.equal(toTradingView('AAPL'), null);
  assert.equal(toTradingView('^GSPC'), null);
});

test('fetches all symbols in one request and keeps input order', async () => {
  const fetch = mockFetch(() => new Response(JSON.stringify({
    data: [
      // Scanner response order is not guaranteed to match the request
      { s: 'NSE:NIFTY', d: [22888.95, -1.1111999, 'Nifty 50 Index'] },
      { s: 'NSE:RELIANCE', d: [1202, -0.7595, 'Reliance Industries Limited'] },
    ],
  })));
  try {
    const body = await invokeHandler('RELIANCE.NS,^NSEI');
    assert.equal(fetch.calls.length, 1);
    assert.deepEqual(fetch.calls[0].symbols.tickers, ['NSE:RELIANCE', 'NSE:NIFTY']);
    assert.deepEqual(body.tickers, [
      { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', price: 1202, change: '-0.76%' },
      { symbol: '^NSEI', name: 'Nifty 50 Index', price: 22888.95, change: '-1.11%' },
    ]);
    assert.equal(body.currency_symbol, '₹');
  } finally {
    fetch.restore();
  }
});

test('unknown and unmappable symbols degrade without failing the rest', async () => {
  const fetch = mockFetch(() => new Response(JSON.stringify({
    data: [{ s: 'NSE:TCS', d: [2460.9, -0.1663, 'Tata Consultancy Services Limited'] }],
  })));
  try {
    const body = await invokeHandler('500325.BO,NOPE.NS,TCS.NS');
    assert.deepEqual(fetch.calls[0].symbols.tickers, ['NSE:NOPE', 'NSE:TCS']);
    assert.deepEqual(body.tickers.map((t: any) => t.name), [
      'SYMBOL_NOT_SUPPORTED',
      'SYMBOL_NOT_SUPPORTED',
      'Tata Consultancy Services Limited',
    ]);
  } finally {
    fetch.restore();
  }
});

test('upstream failure degrades every ticker instead of erroring', async () => {
  const fetch = mockFetch(() => new Response('nope', { status: 500 }));
  try {
    const body = await invokeHandler('TCS.NS');
    assert.deepEqual(body.tickers, [
      { symbol: 'TCS.NS', name: 'SYMBOL_NOT_SUPPORTED', price: 0, change: '' },
    ]);
  } finally {
    fetch.restore();
  }
});
