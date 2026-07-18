import assert from 'node:assert/strict';
import test from 'node:test';
import {
  citiesAsOptions,
  distanceKm,
  findStation,
  nearestStations,
  stationsAsOptions,
} from './weather-stations.js';
import { resolveLocation } from './weather.js';

test('lists cities alphabetically', () => {
  const options = citiesAsOptions();
  assert.ok(options.length > 1);
  assert.deepEqual(options, [...options].sort((a, b) =>
    Object.keys(a)[0].localeCompare(Object.keys(b)[0])));
  assert.ok(options.some((option) => option.Bengaluru === 'bengaluru'));
});

test('lists Bannerghatta Road under Bengaluru', () => {
  const options = stationsAsOptions('bengaluru');
  assert.ok(options.some((option) =>
    option['Bannerghatta Road, Bangalore'] === 'ZWL004924'));
});

test('resolves station ID and exact name case-insensitively', () => {
  const byId = findStation('zwl004924');
  const byName = findStation('BANNERGHATTA ROAD, BANGALORE');
  assert.equal(byId?.id, 'ZWL004924');
  assert.deepEqual(byName, byId);
  assert.equal(byId?.latitude, 12.891397);
  assert.equal(byId?.longitude, 77.608176);
});

test('does not fuzzy-match unknown text', () => {
  assert.equal(findStation('Bannerghatta'), null);
});

test('catalog station becomes canonical coordinates and name', async () => {
  assert.deepEqual(await resolveLocation('ZWL004924'), {
    lat: 12.891397,
    lon: 77.608176,
    name: 'Bannerghatta Road, Bangalore',
  });
});

test('coordinates remain supported', async () => {
  assert.deepEqual(await resolveLocation('12.891397,77.608176'), {
    lat: 12.891397,
    lon: 77.608176,
    name: '12.891397,77.608176',
  });
});

test('free text remains supported through geocoding', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    results: [{
      latitude: 12.9716,
      longitude: 77.5946,
      name: 'Bengaluru',
    }],
  }));

  try {
    assert.deepEqual(await resolveLocation('Bengaluru'), {
      lat: 12.9716,
      lon: 77.5946,
      name: 'Bengaluru',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('orders neighbors by distance and excludes the origin', () => {
  const origin = findStation('ZWL004924');
  assert.ok(origin);
  const neighbors = nearestStations(origin, 5);
  assert.equal(neighbors.some((station) => station.id === origin.id), false);
  for (let i = 1; i < neighbors.length; i += 1) {
    const prev = distanceKm(origin, neighbors[i - 1]);
    const next = distanceKm(origin, neighbors[i]);
    assert.ok(prev <= next + 1e-9);
    if (Math.abs(prev - next) < 1e-9) {
      assert.ok(neighbors[i - 1].id < neighbors[i].id);
    }
  }
});

test('nearestStations defaults to three candidates', () => {
  const origin = findStation('ZWL004924');
  assert.ok(origin);
  assert.equal(nearestStations(origin).length, 3);
});

test('distanceKm is symmetric and zero for the same point', () => {
  const a = { latitude: 12.891397, longitude: 77.608176 };
  const b = { latitude: 12.97, longitude: 77.64 };
  assert.equal(distanceKm(a, a), 0);
  assert.ok(Math.abs(distanceKm(a, b) - distanceKm(b, a)) < 1e-9);
  assert.ok(distanceKm(a, b) > 0);
});
