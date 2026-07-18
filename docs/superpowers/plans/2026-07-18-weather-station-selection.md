# Weather Station Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable Weather Union station resolution and a chained City → Station selector to the TRMNL weather plugin.

**Architecture:** A checked-in JSON catalog is the single source of truth for Weather Union cities, station IDs, names, coordinates, and device types. Pure TypeScript helpers index that catalog; the existing weather handler uses them before Open-Meteo, while a new public endpoint exposes TRMNL-compatible dropdown options.

**Tech Stack:** TypeScript 5, Vercel Node functions, Node's built-in test runner via `tsx`, TRMNL `xhrSelect` custom fields, Liquid polling URL interpolation.

## Global Constraints

- Preserve coordinate and Open-Meteo free-text location support.
- Return display-ready weather errors with HTTP 200, matching existing behavior.
- The dropdown stores Weather Union locality IDs; labels show locality names.
- Deploy option endpoints before pointing live plugin settings at them.
- Do not change weather screen markup or the approved design document.
- Do not create git commits unless the user explicitly asks.

---

## File Structure

- Create `api/weather-stations.json`: complete station catalog transcribed from the provided Weather Union PDF.
- Create `api/weather-stations.ts`: catalog types, indexes, normalization, lookup helpers, and dropdown option builders.
- Create `api/weather-stations.test.ts`: pure catalog and resolution tests.
- Create `api/weather-locations.ts`: public GET endpoint for chained dropdown options.
- Create `api/weather-locations.test.ts`: handler tests for city and station responses.
- Modify `api/weather.ts`: resolve locality IDs and exact catalog names before coordinates/Open-Meteo.
- Modify `package.json`: add the TypeScript test runner and test script.
- Modify `plugins/weather/README.md`: document station selection, compatibility, and catalog provenance.
- Modify TRMNL settings through MCP after production endpoints are live.

### Task 1: Catalog and station lookup helpers

**Files:**
- Create: `api/weather-stations.json`
- Create: `api/weather-stations.ts`
- Create: `api/weather-stations.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `WeatherStation`, `SelectOption`, `citiesAsOptions()`, `stationsAsOptions(city)`, and `findStation(location)`.
- `findStation(location: string): WeatherStation | null` matches locality ID or exact locality name case-insensitively.

- [ ] **Step 1: Add the test runner**

Run: `npm install --save-dev tsx`

Add:

```json
"test": "node --import tsx --test api/**/*.test.ts"
```

- [ ] **Step 2: Write failing catalog tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  citiesAsOptions,
  findStation,
  stationsAsOptions,
} from './weather-stations.js';

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
```

- [ ] **Step 3: Run tests and confirm the missing-module failure**

Run: `npm test`

Expected: FAIL because `api/weather-stations.ts` does not exist.

- [ ] **Step 4: Add the complete catalog**

Create `api/weather-stations.json` as an array of every row in the provided PDF:

```json
[
  {
    "city": "Bengaluru",
    "name": "Bannerghatta Road, Bangalore",
    "id": "ZWL004924",
    "latitude": 12.891397,
    "longitude": 77.608176,
    "deviceType": 1
  }
]
```

The actual file must include every published row, not only this example. Preserve
the PDF's names and numeric precision exactly. Reject duplicate locality IDs
during verification.

- [ ] **Step 5: Implement pure catalog helpers**

```ts
import rawStations from './weather-stations.json' with { type: 'json' };

export interface WeatherStation {
  city: string;
  name: string;
  id: string;
  latitude: number;
  longitude: number;
  deviceType: 1 | 2;
}

export type SelectOption = Record<string, string>;

const stations = rawStations as WeatherStation[];
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-IN');
const cityValue = (city: string) =>
  normalize(city).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const byId = new Map(stations.map((station) => [normalize(station.id), station]));
const byName = new Map(stations.map((station) => [normalize(station.name), station]));

export function findStation(location: string): WeatherStation | null {
  const key = normalize(location);
  return byId.get(key) ?? byName.get(key) ?? null;
}

export function citiesAsOptions(): SelectOption[] {
  return [...new Set(stations.map((station) => station.city))]
    .sort((a, b) => a.localeCompare(b))
    .map((city) => ({ [city]: cityValue(city) }));
}

export function stationsAsOptions(city: string): SelectOption[] {
  const key = normalize(city);
  return stations
    .filter((station) => cityValue(station.city) === key)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((station) => ({ [station.name]: station.id }));
}
```

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: all four station tests PASS.

### Task 2: Chained dropdown endpoint

**Files:**
- Create: `api/weather-locations.ts`
- Create: `api/weather-locations.test.ts`

**Interfaces:**
- Consumes: `citiesAsOptions()` and `stationsAsOptions(city)` from Task 1.
- Produces: Vercel handler returning `Array<Record<string, string>>`.

- [ ] **Step 1: Write failing endpoint tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './weather-locations.js';

function response() {
  let body: unknown;
  return {
    statusCode: 0,
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
  assert.ok((res.body as object[]).some(
    (item) => item['Bannerghatta Road, Bangalore'] === 'ZWL004924'));
});

test('returns an empty array for an unknown city', async () => {
  const res = response();
  await handler({ query: { city: 'unknown' } } as never, res as never);
  assert.deepEqual(res.body, []);
});
```

- [ ] **Step 2: Run tests and confirm the missing-module failure**

Run: `npm test`

Expected: FAIL because `api/weather-locations.ts` does not exist.

- [ ] **Step 3: Implement the endpoint**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { citiesAsOptions, stationsAsOptions } from './weather-stations.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const city = typeof req.query.city === 'string' ? req.query.city : '';
  return res.status(200).json(city ? stationsAsOptions(city) : citiesAsOptions());
}
```

- [ ] **Step 4: Run endpoint and catalog tests**

Run: `npm test`

Expected: all tests PASS.

### Task 3: Use station IDs and canonical names in weather responses

**Files:**
- Modify: `api/weather.ts:57-77,98-106`
- Modify: `api/weather-stations.test.ts`

**Interfaces:**
- Consumes: `findStation(location)`.
- Preserves: coordinate parsing and `geocode(query)` fallback.

- [ ] **Step 1: Extend resolution tests**

Add a pure exported resolver in `api/weather.ts` and tests covering:

```ts
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
```

Mock `globalThis.fetch` for the existing free-text geocoding test so it returns a
known Open-Meteo result without network access.

- [ ] **Step 2: Run tests and confirm the missing-export failure**

Run: `npm test`

Expected: FAIL because `resolveLocation` is not exported.

- [ ] **Step 3: Implement station-first resolution**

```ts
import { findStation } from './weather-stations.js';

export async function resolveLocation(location: string): Promise<Coords | null> {
  const station = findStation(location);
  if (station) {
    return {
      lat: station.latitude,
      lon: station.longitude,
      name: station.name,
    };
  }

  const match = location.match(LATLON_RE);
  if (match) {
    return {
      lat: parseFloat(match[1]),
      lon: parseFloat(match[2]),
      name: location,
    };
  }

  return geocode(location);
}
```

Replace the handler's inline resolution branch with
`const coords = await resolveLocation(location)`.

- [ ] **Step 4: Run all tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all tests PASS and TypeScript exits 0.

### Task 4: Documentation and local endpoint verification

**Files:**
- Modify: `plugins/weather/README.md`

- [ ] **Step 1: Update location documentation**

Document City → Station as the preferred setup, locality IDs as stored values,
the provided Weather Union PDF as catalog provenance, and coordinates/free text
as backward-compatible API inputs.

- [ ] **Step 2: Start local Vercel development server**

Run: `npm run dev`

Expected: server starts and reports its local URL.

- [ ] **Step 3: Verify dropdown and weather responses**

Run:

```bash
curl -s 'http://localhost:3000/api/weather-locations'
curl -s 'http://localhost:3000/api/weather-locations?city=bengaluru'
curl -s 'http://localhost:3000/api/weather?location=ZWL004924'
```

Expected:
- cities include `{"Bengaluru":"bengaluru"}`
- Bengaluru stations include
  `{"Bannerghatta Road, Bangalore":"ZWL004924"}`
- weather has `"area":"Bannerghatta Road, Bangalore"` and `"error":null`

### Task 5: Safe production rollout and TRMNL settings

**Files:**
- External: Vercel deployment
- External: TRMNL custom fields and polling URL

**Interfaces:**
- City endpoint:
  `https://trmnl-cyan.vercel.app/api/weather-locations`
- Station endpoint:
  `https://trmnl-cyan.vercel.app/api/weather-locations?city={{city}}`
- Polling:
  `https://trmnl-cyan.vercel.app/api/weather?location={{ station | default: location | default: '12.891397,77.608176' }}`

- [ ] **Step 1: Deploy without changing git history**

Use the connected Vercel deployment tool to deploy the working tree. Do not
commit or push unless the user separately authorizes it.

- [ ] **Step 2: Verify production endpoints**

Fetch the three production URLs used in Task 4 and confirm the same city,
station, and canonical weather results.

- [ ] **Step 3: Read current TRMNL integration and merge variables**

Confirm the plugin remains healthy and current weather data is non-empty before
changing settings.

- [ ] **Step 4: Write chained custom fields**

```yaml
- keyname: city
  field_type: xhrSelect
  name: City
  endpoint: https://trmnl-cyan.vercel.app/api/weather-locations
  http_verb: GET
  exclude_csrf_token: true

- keyname: station
  field_type: xhrSelect
  name: Station
  depends_on: city
  endpoint: https://trmnl-cyan.vercel.app/api/weather-locations?city={{city}}
  http_verb: GET
  exclude_csrf_token: true

- keyname: location
  field_type: hidden
  name: Legacy Location
  default: 12.891397,77.608176
  optional: true
```

Update the polling URL to the interface documented above.

- [ ] **Step 5: Select and save the live station**

In plugin settings, select:

- City: Bengaluru
- Station: Bannerghatta Road, Bangalore

If MCP cannot set custom field values, ask the user to make these two selections
in the TRMNL dashboard; do not guess or substitute values.

- [ ] **Step 6: Force-refresh and verify merge variables**

Expected:
- `area`: `Bannerghatta Road, Bangalore`
- `temperature` and `humidity`: non-null
- `error`: null

- [ ] **Step 7: Screenshot the full layout**

Render `markup_full` and confirm no overflow, clipping, or layout regression.

- [ ] **Step 8: Run final repository checks**

Run: `npm test && npm run typecheck && git diff --check && git status --short`

Expected: tests and typecheck pass; diff check is clean; only intended files are
modified or untracked.
