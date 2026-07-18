import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './weather-locations.js';

function response() {
  let body: unknown;
  return {
    statusCode: 0,
    setHeader() { return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
    get body() { return body; },
  };
}

test('returns city options without a city query', async () => {
  const res = response();
  await handler({ query: {} } as never, res as never);
  assert.equal(res.statusCode, 200);
  assert.ok((res.body as object[]).some((item) => 'Bengaluru' in item));
});

test('returns stations for a selected city', async () => {
  const res = response();
  await handler({ query: { city: 'bengaluru' } } as never, res as never);
  assert.ok((res.body as Record<string, string>[]).some(
    (item) => item['Bannerghatta Road, Bangalore'] === 'ZWL004924'));
});

test('returns an empty array for an unknown city', async () => {
  const res = response();
  await handler({ query: { city: 'unknown' } } as never, res as never);
  assert.deepEqual(res.body, []);
});
