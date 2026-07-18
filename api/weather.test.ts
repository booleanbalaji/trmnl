import assert from 'node:assert/strict';
import test from 'node:test';
import {
  default as handler,
  hasMissingDisplayFields,
  mergeMissingFields,
  payload,
} from './weather.js';
import { findStation, nearestStations } from './weather-stations.js';

const completeWeatherData = (overrides: Record<string, unknown> = {}) => ({
  temperature: 24,
  humidity: 70,
  wind_speed: 2,
  wind_direction: 90,
  rain_intensity: 0,
  rain_accumulation: 0,
  aqi_pm_2_point_5: 20,
  aqi_pm_10: 30,
  ...overrides,
});

const weatherResponse = (data: Record<string, unknown>) =>
  new Response(JSON.stringify({
    status: '200',
    locality_weather_data: data,
  }));

async function invokeHandler(location: string) {
  let result: unknown;
  const req = { query: { location } };
  const res = {
    setHeader() {},
    status() { return res; },
    json(body: unknown) {
      result = body;
      return body;
    },
  };

  await handler(req as any, res as any);
  return result as ReturnType<typeof payload>;
}

test('detects missing display fields', () => {
  assert.equal(hasMissingDisplayFields(payload({
    temperature: 23,
    humidity: 80,
    wind_speed_kmh: 5,
    wind_direction: 'N',
    rain_intensity: 0,
    rain_accumulation: 0,
    rain_status: 'No rain',
    aqi_pm25: 20,
    aqi_pm10: 30,
    aqi_label: 'Good',
  })), false);
  assert.equal(hasMissingDisplayFields(payload({ temperature: 23 })), true);
});

test('fills only null primary fields from one fallback', () => {
  const primary = payload({
    area: 'Bannerghatta Road, Bangalore',
    temperature: 23,
    humidity: null,
    aqi_pm25: null,
    aqi_label: null,
  });
  const fallback = payload({
    area: 'Some Other Station',
    temperature: 99,
    humidity: 70,
    aqi_pm25: 45,
    aqi_label: 'Satisfactory',
  });
  const { payload: merged, filled } = mergeMissingFields(primary, fallback);
  assert.equal(filled, true);
  assert.equal(merged.area, 'Bannerghatta Road, Bangalore');
  assert.equal(merged.temperature, 23);
  assert.equal(merged.humidity, 70);
  assert.equal(merged.aqi_pm25, 45);
  assert.equal(merged.aqi_label, 'Satisfactory');
});

test('reports no fill when fallback adds nothing', () => {
  const primary = payload({ temperature: null, humidity: 80 });
  const fallback = payload({ temperature: null, humidity: 10 });
  const { payload: merged, filled } = mergeMissingFields(primary, fallback);
  assert.equal(filled, false);
  assert.equal(merged.humidity, 80);
  assert.equal(merged.temperature, null);
});

test('does not fallback when primary request fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.WEATHER_UNION_API_KEY;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  };
  process.env.WEATHER_UNION_API_KEY = 'test-key';

  try {
    const result = await invokeHandler('ZWL004924');
    assert.equal(fetchCalls, 1);
    assert.equal(result.area, 'Bannerghatta Road, Bangalore');
    assert.equal(result.error, 'No weather station near Bannerghatta Road, Bangalore');
    assert.equal(result.fallback_used, false);
    assert.equal(result.fallback_station, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.WEATHER_UNION_API_KEY;
    else process.env.WEATHER_UNION_API_KEY = originalApiKey;
  }
});

test('fills missing metrics from the first helpful nearby station', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.WEATHER_UNION_API_KEY;
  const selected = findStation('ZWL004924');
  assert.ok(selected);
  const [firstNearby] = nearestStations(selected, 3);
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return fetchCalls === 1
      ? weatherResponse(completeWeatherData({
        temperature: 26,
        aqi_pm_2_point_5: null,
        aqi_pm_10: null,
      }))
      : weatherResponse(completeWeatherData({
        temperature: 99,
        aqi_pm_2_point_5: 45,
        aqi_pm_10: 55,
      }));
  };
  process.env.WEATHER_UNION_API_KEY = 'test-key';

  try {
    const result = await invokeHandler('ZWL004924');
    assert.equal(fetchCalls, 2);
    assert.equal(result.area, 'Bannerghatta Road, Bangalore');
    assert.equal(result.temperature, 26);
    assert.equal(result.aqi_pm25, 45);
    assert.equal(result.aqi_label, 'Satisfactory');
    assert.equal(result.fallback_used, true);
    assert.equal(result.fallback_station, firstNearby.name);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.WEATHER_UNION_API_KEY;
    else process.env.WEATHER_UNION_API_KEY = originalApiKey;
  }
});

test('stops after three nearby attempts even if none help', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.WEATHER_UNION_API_KEY;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return weatherResponse(completeWeatherData({ humidity: null }));
  };
  process.env.WEATHER_UNION_API_KEY = 'test-key';

  try {
    const result = await invokeHandler('ZWL004924');
    assert.equal(fetchCalls, 4);
    assert.equal(result.humidity, null);
    assert.equal(result.fallback_used, false);
    assert.equal(result.fallback_station, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.WEATHER_UNION_API_KEY;
    else process.env.WEATHER_UNION_API_KEY = originalApiKey;
  }
});

test('skips failed nearby requests and continues', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.WEATHER_UNION_API_KEY;
  const selected = findStation('ZWL004924');
  assert.ok(selected);
  const nearby = nearestStations(selected, 3);
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return weatherResponse(completeWeatherData({ humidity: null }));
    if (fetchCalls === 2) throw new Error('nearby station unavailable');
    return weatherResponse(completeWeatherData({ humidity: 61 }));
  };
  process.env.WEATHER_UNION_API_KEY = 'test-key';

  try {
    const result = await invokeHandler('ZWL004924');
    assert.equal(fetchCalls, 3);
    assert.equal(result.humidity, 61);
    assert.equal(result.fallback_used, true);
    assert.equal(result.fallback_station, nearby[1].name);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.WEATHER_UNION_API_KEY;
    else process.env.WEATHER_UNION_API_KEY = originalApiKey;
  }
});

test('skips catalog fallback for raw coordinates', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.WEATHER_UNION_API_KEY;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return weatherResponse(completeWeatherData({ humidity: null }));
  };
  process.env.WEATHER_UNION_API_KEY = 'test-key';

  try {
    const result = await invokeHandler('12.891397,77.608176');
    assert.equal(fetchCalls, 1);
    assert.equal(result.area, '12.891397,77.608176');
    assert.equal(result.humidity, null);
    assert.equal(result.fallback_used, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.WEATHER_UNION_API_KEY;
    else process.env.WEATHER_UNION_API_KEY = originalApiKey;
  }
});
