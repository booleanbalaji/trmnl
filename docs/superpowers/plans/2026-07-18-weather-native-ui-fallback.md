# Weather Native UI and Station Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Weather Union screen mimic TRMNL's native current-conditions layout, show the selected area name (never coordinates), and fill missing readings from one nearby catalog station.

**Architecture:** Catalog helpers compute ordered neighbors by geographic distance. The weather handler fetches the selected station first, then tries up to three nearer catalog stations and merges missing display fields from the first helpful candidate. Liquid markup is rebuilt per view size with fixed grid spans and omitted null metrics so text cannot overlap.

**Tech Stack:** TypeScript 5, Vercel Node functions, Node's built-in test runner via `tsx`, TRMNL Liquid markup + MCP screenshot loop.

## Global Constraints

- Current conditions only — no Open-Meteo forecast and no fabricated weather icons.
- Fallback runs only when `findStation(location)` returns a catalog station.
- Never overwrite primary non-null values; never change `area` to the fallback station name.
- Cap nearby Weather Union requests at three candidates.
- Primary API failure returns an error payload and does not attempt fallback.
- No custom CSS, `vw`/`vh`, `position: fixed`, or emoji in markup.
- Do not wrap markup in a `view` class — start with `layout`.
- Always return HTTP 200 with display-ready errors.
- Do not create git commits unless the user explicitly asks.
- Spec source of truth: `docs/superpowers/specs/2026-07-18-weather-native-ui-fallback-design.md`.

---

## File Structure

- Modify `api/weather-stations.ts`: add haversine distance and `nearestStations`.
- Modify `api/weather-stations.test.ts`: cover distance ordering, exclusion, limits, and ties.
- Modify `api/weather.ts`: extract fetch + merge helpers; wire bounded single-station fallback; add `fallback_used` / `fallback_station`.
- Create `api/weather.test.ts`: cover merge behavior and handler fallback orchestration with mocked `fetch`.
- Modify `plugins/weather/markup.liquid`: version-controlled full-size markup mirror.
- Update TRMNL markup via MCP for `markup_full`, `markup_half_horizontal`, `markup_half_vertical`, `markup_quadrant`.
- Modify `plugins/weather/README.md`: document nearby fallback and native-style UI.

### Task 1: Nearest-station catalog helpers

**Files:**
- Modify: `api/weather-stations.ts`
- Modify: `api/weather-stations.test.ts`

**Interfaces:**
- Consumes: existing `WeatherStation` catalog and `findStation`.
- Produces:
  - `distanceKm(a: Pick<WeatherStation, 'latitude' | 'longitude'>, b: Pick<WeatherStation, 'latitude' | 'longitude'>): number`
  - `nearestStations(origin: WeatherStation, limit?: number): WeatherStation[]` — excludes `origin.id`, sorts ascending by distance, breaks ties by `id` ascending, defaults `limit` to `3`.

- [ ] **Step 1: Write failing nearest-station tests**

Append to `api/weather-stations.test.ts`:

```ts
import { distanceKm, nearestStations, findStation } from './weather-stations.js';

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
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- api/weather-stations.test.ts`

Expected: FAIL because `distanceKm` / `nearestStations` are not exported.

- [ ] **Step 3: Implement distance helpers**

Add to `api/weather-stations.ts`:

```ts
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceKm(
  a: Pick<WeatherStation, 'latitude' | 'longitude'>,
  b: Pick<WeatherStation, 'latitude' | 'longitude'>,
): number {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestStations(origin: WeatherStation, limit = 3): WeatherStation[] {
  return stations
    .filter((station) => station.id !== origin.id)
    .map((station) => ({ station, distance: distanceKm(origin, station) }))
    .sort((a, b) => a.distance - b.distance || a.station.id.localeCompare(b.station.id))
    .slice(0, limit)
    .map(({ station }) => station);
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test -- api/weather-stations.test.ts`

Expected: PASS for all weather-stations tests, including existing lookup tests.

- [ ] **Step 5: Commit only if the user asked**

If commits were requested for this work session, stage `api/weather-stations.ts` and `api/weather-stations.test.ts` and commit with:

```text
Add nearest-station helpers for Weather Union catalog.
```

Otherwise leave changes uncommitted and continue.

### Task 2: Payload merge helpers

**Files:**
- Modify: `api/weather.ts`
- Create: `api/weather.test.ts`

**Interfaces:**
- Consumes: existing display-ready `WeatherPayload` shape (extend with fallback fields).
- Produces:
  - `DISPLAY_FIELDS: readonly (keyof WeatherPayload)[]` — nullable metric keys that can be filled.
  - `hasMissingDisplayFields(payload: WeatherPayload): boolean`
  - `mergeMissingFields(primary: WeatherPayload, fallback: WeatherPayload): { payload: WeatherPayload; filled: boolean }`
  - Extended payload fields: `fallback_used: boolean`, `fallback_station: string | null`

Display fields eligible for fill-in:

```ts
['temperature', 'humidity', 'wind_speed_kmh', 'wind_direction',
 'rain_intensity', 'rain_accumulation', 'rain_status',
 'aqi_pm25', 'aqi_pm10', 'aqi_label'] as const
```

Do **not** treat `area`, `updated_at`, `error`, `fallback_used`, or `fallback_station` as fillable.

- [ ] **Step 1: Write failing merge tests**

Create `api/weather.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasMissingDisplayFields,
  mergeMissingFields,
  payload,
} from './weather.js';

test('detects missing display fields', () => {
  assert.equal(hasMissingDisplayFields(payload({ temperature: 23, humidity: 80 })), false);
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
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- api/weather.test.ts`

Expected: FAIL because merge helpers are not exported.

- [ ] **Step 3: Implement merge helpers in `api/weather.ts`**

Extend `WeatherPayload`:

```ts
interface WeatherPayload {
  area: string | null;
  temperature: number | null;
  humidity: number | null;
  wind_speed_kmh: number | null;
  wind_direction: string | null;
  rain_intensity: number | null;
  rain_accumulation: number | null;
  rain_status: string | null;
  aqi_pm25: number | null;
  aqi_pm10: number | null;
  aqi_label: string | null;
  updated_at: string;
  error: string | null;
  fallback_used: boolean;
  fallback_station: string | null;
}
```

Export:

```ts
export const DISPLAY_FIELDS = [
  'temperature', 'humidity', 'wind_speed_kmh', 'wind_direction',
  'rain_intensity', 'rain_accumulation', 'rain_status',
  'aqi_pm25', 'aqi_pm10', 'aqi_label',
] as const;

export function hasMissingDisplayFields(data: WeatherPayload): boolean {
  return DISPLAY_FIELDS.some((field) => data[field] === null);
}

export function mergeMissingFields(
  primary: WeatherPayload,
  fallback: WeatherPayload,
): { payload: WeatherPayload; filled: boolean } {
  let filled = false;
  const merged = { ...primary };
  for (const field of DISPLAY_FIELDS) {
    if (merged[field] === null && fallback[field] !== null) {
      (merged as any)[field] = fallback[field];
      filled = true;
    }
  }
  return { payload: merged, filled };
}
```

Update `payload()` defaults to include `fallback_used: false` and `fallback_station: null`.

Export `payload` for tests (it can remain a named export; keep the default handler unchanged for now).

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test -- api/weather.test.ts`

Expected: PASS for the three merge tests.

- [ ] **Step 5: Commit only if the user asked**

Suggested message if committing:

```text
Add weather payload merge helpers for nearby station fill-in.
```

### Task 3: Bounded fallback orchestration in the weather handler

**Files:**
- Modify: `api/weather.ts`
- Modify: `api/weather.test.ts`
- Modify: `api/weather-stations.test.ts` only if needed for shared fixtures

**Interfaces:**
- Consumes: `findStation`, `nearestStations`, `mergeMissingFields`, `hasMissingDisplayFields`.
- Produces:
  - `fetchWeatherUnion(lat: number, lon: number, apiKey: string): Promise<WeatherPayload | null>`
    — returns a display-ready payload without `area`/`error` filled by the caller, or `null` on HTTP/status/data failure.
  - Handler behavior:
    1. Resolve location; set `area` from `coords.name`.
    2. Fetch primary; on `null`, return error payload with `area` and **no** fallback.
    3. If `findStation(location)` is null, return primary with `fallback_used: false`.
    4. Else if primary has missing display fields, iterate `nearestStations(selected, 3)`.
    5. For each candidate, fetch; skip failures; on first merge with `filled === true`, set `fallback_used: true` and `fallback_station` to the candidate name, then stop.
    6. Always keep selected `area`.

- [ ] **Step 1: Write failing handler orchestration tests**

Append to `api/weather.test.ts` using a mocked `globalThis.fetch`. Cover at least:

```ts
test('does not fallback when primary request fails', async () => {
  // mock Weather Union primary failure → error payload, only one fetch for weather
});

test('fills missing metrics from the first helpful nearby station', async () => {
  // primary missing AQI; nearest helpful station supplies AQI
  // assert area stays Bannerghatta name
  // assert fallback_used true and fallback_station set
  // assert temperature from primary preserved
});

test('stops after three nearby attempts even if none help', async () => {
  // primary missing humidity; three nearby responses also missing humidity
  // assert exactly 1 primary + 3 nearby weather fetches
  // assert fallback_used false
});

test('skips failed nearby requests and continues', async () => {
  // first nearby throws/fails; second nearby fills missing field
});

test('skips catalog fallback for raw coordinates', async () => {
  // location '12.891397,77.608176' with partial primary → no nearby fetches
});
```

Use `ZWL004924` as the selected station ID for catalog cases. Mock Open-Meteo only if a free-text path is exercised; prefer catalog IDs so geocoding is unused.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- api/weather.test.ts`

Expected: FAIL because the handler does not yet perform fallback.

- [ ] **Step 3: Extract `fetchWeatherUnion` and wire fallback**

Refactor `api/weather.ts` so the existing locality-weather mapping lives in `fetchWeatherUnion`. Then replace the handler success path with:

```ts
const selected = findStation(location);
const primaryData = await fetchWeatherUnion(coords.lat, coords.lon, apiKey);
if (!primaryData) {
  return res.json(payload({ area: coords.name, error: `No weather station near ${coords.name}` }));
}

let result = payload({ ...primaryData, area: coords.name });

if (selected && hasMissingDisplayFields(result)) {
  for (const candidate of nearestStations(selected, 3)) {
    try {
      const nearby = await fetchWeatherUnion(candidate.latitude, candidate.longitude, apiKey);
      if (!nearby) continue;
      const { payload: merged, filled } = mergeMissingFields(result, {
        ...nearby,
        area: coords.name,
      });
      if (filled) {
        result = {
          ...merged,
          area: coords.name,
          fallback_used: true,
          fallback_station: candidate.name,
        };
        break;
      }
    } catch {
      // skip failed nearby attempt
    }
  }
}

return res.json(result);
```

Keep the outer try/catch returning `payload({ error: 'Weather fetch failed' })` for unexpected primary-path failures.

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: PASS for weather-stations, weather-locations, and weather tests.

- [ ] **Step 5: Commit only if the user asked**

Suggested message:

```text
Fill missing weather metrics from one nearby station.
```

### Task 4: Native-style markup (full first)

**Files:**
- Modify via TRMNL MCP: `markup_full`
- Modify: `plugins/weather/markup.liquid` (mirror of full)

**Interfaces:**
- Consumes merge variables: `area`, `temperature`, `humidity`, `wind_speed_kmh`, `wind_direction`, `rain_status`, `rain_accumulation`, `aqi_pm25`, `aqi_label`, `updated_at`, `error`, `fallback_used`.
- Produces overlap-safe full markup with title bar showing area name.

- [ ] **Step 1: Confirm live merge variables**

Via TRMNL MCP:

1. `IntegrationsShowTool`
2. `MergeVariablesShowTool`

Gate: plugin-specific weather fields must exist. If only globals are present, refresh polling data / fix `location` first — do not write markup.

- [ ] **Step 2: Pull one weather-like recipe for structure**

Use `RecipesSearchTool` / `RecipesPullMarkupTool` for a current-conditions or metrics recipe. Study grid + title_bar patterns; do not copy forecast sections.

- [ ] **Step 3: Write `markup_full`**

Requirements for the Liquid:

- Error branch: centered "Weather unavailable" + `{{ error }}`.
- Success layout:
  - Top: `grid` with `col--span-5` temperature (`value` + `data-fit-value="true"`) and `col--span-7` current conditions stack (humidity, wind, rain_status), each guarded with `{% if ... != nil %}` / `{% if ... %}`.
  - Bottom: `grid grid--cols-3` for rain accumulation, AQI label/value, and a compact nearby note when `fallback_used`.
  - No condition icon.
  - No coordinates.
  - Title bar: instance name, `{{ area }}` as smaller title/instance text, `{{ updated_at }} IST`.
  - When `fallback_used`, show a short `nearby` label on borrowed-context UI only — keep `area` as the selected station name.
- Start with `<div class="layout ...">` — never wrap in `view`.
- Framework classes only — no `<style>`, no inline styles, no emoji.

Also copy the full markup into `plugins/weather/markup.liquid`.

- [ ] **Step 4: Screenshot and self-correct full**

Call screenshot for `markup_full`. Fix any overflow/overlap before continuing. Re-screenshot until clean.

- [ ] **Step 5: Commit only if the user asked**

Suggested message:

```text
Restyle weather full markup after native current-conditions layout.
```

### Task 5: Remaining view sizes

**Files:**
- Modify via TRMNL MCP: `markup_half_horizontal`, `markup_half_vertical`, `markup_quadrant`

**Interfaces:**
- Same merge variables as Task 4.
- Content reduction per the design:
  - Half horizontal: temperature + up to two current metrics in one row.
  - Half vertical: stacked temperature, condition, two-column metrics.
  - Quadrant: temperature + one concise condition only.

- [ ] **Step 1: Write each size one at a time**

After each `MarkupsWriteTool` call, do not move to the next size until the previous size's screenshot is clean enough to continue; batch final verification in Step 2.

- [ ] **Step 2: Batch screenshot all sizes**

Screenshot `markup_full`, `markup_half_horizontal`, `markup_half_vertical`, and `markup_quadrant` together. Fix any overlap/overflow. Re-run until all four pass.

Verification payloads to exercise (via refresh / temporary transform / known station data as available):

- complete readings;
- partial with `fallback_used`;
- partial without fallback fill;
- long `area` string;
- `error` set.

- [ ] **Step 3: Persist markup versions**

If the MCP session supports version save, save after the final clean screenshots so reloads keep the markup.

- [ ] **Step 4: Commit only if the user asked**

Suggested message:

```text
Add weather markup variants for all TRMNL view sizes.
```

### Task 6: Docs and production verification

**Files:**
- Modify: `plugins/weather/README.md`

- [ ] **Step 1: Update README**

Document:

- Native-style current-conditions UI (no forecast, no invented icon).
- Area name comes from the selected station.
- Missing metrics may be filled from one nearby catalog station; the UI marks borrowed context with `nearby`.
- Fallback only applies to catalog station selections, not free-text/coordinates.
- Primary Weather Union failures still surface as on-screen errors.

- [ ] **Step 2: Deploy and smoke-test the API**

Deploy the weather function to Vercel. Verify:

```bash
# complete / partial catalog station
curl -s 'https://trmnl-cyan.vercel.app/api/weather?location=ZWL004924' | jq '{area,temperature,humidity,aqi_pm25,fallback_used,fallback_station,error}'

# coordinates should not set fallback_used via catalog neighbors
curl -s 'https://trmnl-cyan.vercel.app/api/weather?location=12.891397,77.608176' | jq '{area,fallback_used,fallback_station,error}'
```

Expected: HTTP 200 JSON; `area` is a place name for catalog IDs; `fallback_used` is boolean; no stack traces.

- [ ] **Step 3: Refresh TRMNL plugin data and confirm the screen**

Refresh polling data in the dashboard, confirm merge variables include the new fallback fields, and visually confirm the device/preview screen shows the area name with no overlapping text.

- [ ] **Step 4: Commit only if the user asked**

Suggested message:

```text
Document weather nearby fallback and native UI behavior.
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|---|---|
| Single nearby fallback station | Task 3 |
| Max three nearby requests | Task 1 + Task 3 |
| Preserve selected area name | Task 2 + Task 3 |
| `fallback_used` / `fallback_station` | Task 2 + Task 3 |
| No fallback on primary failure | Task 3 |
| No catalog fallback for free-text/coordinates | Task 3 |
| Native current-conditions UI, no forecast/icon | Task 4 + Task 5 |
| Overlap-safe grids + fit values | Task 4 + Task 5 |
| All four view sizes | Task 5 |
| Automated distance/merge/fallback tests | Task 1–3 |
| Screenshot verification matrix | Task 5 |
| README documentation | Task 6 |
