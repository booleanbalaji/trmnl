import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './weather-locations.js';

function response() {
  let body: unknown;
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
    end() { return this; },
    get body() { return body; },
  };
}

test('returns city options without a city query', async () => {
  const res = response();
  await handler({ query: {}, method: 'GET' } as never, res as never);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.ok((res.body as object[]).some((item) => 'Bengaluru' in item));
});

test('returns stations for a selected city', async () => {
  const res = response();
  await handler({ query: { city: 'bengaluru' }, method: 'GET' } as never, res as never);
  assert.ok((res.body as Record<string, string>[]).some(
    (item) => item['Bannerghatta Road, Bangalore'] === 'ZWL004924'));
});

test('returns an empty array for an unknown city', async () => {
  const res = response();
  await handler({ query: { city: 'unknown' }, method: 'GET' } as never, res as never);
  assert.deepEqual(res.body, []);
});

test('answers CORS preflight without a body', async () => {
  const res = response();
  await handler({ query: {}, method: 'OPTIONS' } as never, res as never);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(res.body, undefined);
});
