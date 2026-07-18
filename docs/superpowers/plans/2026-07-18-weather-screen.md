# Weather Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen TRMNL plugin showing hyperlocal current weather + AQI for a configurable Indian location, powered by Weather Union.

**Architecture:** TRMNL cloud polls `api/weather.ts?location={{ location }}` (Vercel serverless). The function geocodes area names via Open-Meteo, fetches current conditions from Weather Union (`x-zomato-api-key`), and returns flat display-ready JSON. Liquid markup (edited via TRMNL MCP) renders it; a copy is synced to `plugins/weather/`.

**Tech Stack:** TypeScript, Vercel serverless functions, Weather Union API, Open-Meteo geocoding API, TRMNL Liquid markup + framework CSS, TRMNL MCP server.

**Spec:** `docs/superpowers/specs/2026-07-18-weather-screen-design.md`

## Global Constraints

- No test framework (project convention) — verification is `npm run typecheck` + `vercel dev`/curl locally, MCP force refresh live.
- `WEATHER_UNION_API_KEY` is secret: lives in `trmnl.env` (gitignored, already saved) and Vercel project env. Never committed, never echoed into READMEs.
- Always respond HTTP 200 to TRMNL, with `error` string populated on failure (broken screens are worse than error text).
- All data fields nullable — stations report subsets (verified live: full station returned `aqi_pm_10: null`).
- E-ink rendering rules from `CLAUDE.md`: no `vw`/`vh`/`position: fixed`; `.view`/`.content-container`/`.title_bar` flex pattern; typography components are purpose-specific.
- Markup source of truth is the TRMNL dashboard; `plugins/weather/markup.liquid` is the version-controlled copy.

---

### Task 1: `api/weather.ts` — data endpoint

**Files:**
- Create: `api/weather.ts`

**Interfaces:**
- Consumes: `WEATHER_UNION_API_KEY` env var; `?location=` query param.
- Produces (for Task 3's markup — merge variable names): JSON body
  `{ area, temperature, humidity, wind_speed_kmh, wind_direction, rain_intensity, rain_accumulation, rain_status, aqi_pm25, aqi_pm10, aqi_label, updated_at, error }`
  — all nullable except `updated_at` (string, IST clock time) and `error` (string | null).

- [ ] **Step 1: Write the function**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Flat, display-ready shape: all derivation (compass text, rain/AQI labels,
// unit conversion) happens here because Liquid is a weak place for logic.
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
}

const WU_URL = 'https://www.weatherunion.com/gw/weather/external/v0/get_weather_data';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const round1 = (n: number) => Math.round(n * 10) / 10;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function compass(deg: number | null): string | null {
  if (deg === null) return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// rain_intensity is mm/min per Weather Union docs
function rainStatus(intensity: number | null): string | null {
  if (intensity === null) return null;
  if (intensity === 0) return 'No rain';
  if (intensity < 0.25) return 'Light rain';
  if (intensity < 1) return 'Moderate rain';
  return 'Heavy rain';
}

// Indian AQI bands on PM2.5 concentration
function aqiLabel(pm25: number | null): string | null {
  if (pm25 === null) return null;
  if (pm25 <= 30) return 'Good';
  if (pm25 <= 60) return 'Satisfactory';
  if (pm25 <= 90) return 'Moderate';
  if (pm25 <= 120) return 'Poor';
  if (pm25 <= 250) return 'Very Poor';
  return 'Severe';
}

const istTime = () =>
  new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });

interface Coords { lat: number; lon: number; name: string }

const LATLON_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

// Open-Meteo matches single place names, so "Indiranagar, Bengaluru" falls
// back to its first comma segment when the full string misses.
async function geocode(query: string): Promise<Coords | null> {
  const candidates = [...new Set([query, query.split(',')[0].trim()])].filter(Boolean);
  for (const q of candidates) {
    const resp = await fetch(`${GEO_URL}?name=${encodeURIComponent(q)}&count=1`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) continue;
    const body: any = await resp.json();
    const hit = body?.results?.[0];
    if (hit && typeof hit.latitude === 'number' && typeof hit.longitude === 'number') {
      return { lat: hit.latitude, lon: hit.longitude, name: hit.name ?? q };
    }
  }
  return null;
}

function payload(partial: Partial<WeatherPayload>): WeatherPayload {
  return {
    area: null, temperature: null, humidity: null, wind_speed_kmh: null,
    wind_direction: null, rain_intensity: null, rain_accumulation: null,
    rain_status: null, aqi_pm25: null, aqi_pm10: null, aqi_label: null,
    updated_at: istTime(), error: null, ...partial,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
  res.status(200);

  const apiKey = process.env.WEATHER_UNION_API_KEY;
  if (!apiKey) return res.json(payload({ error: 'API key not configured' }));

  const location = typeof req.query.location === 'string' ? req.query.location.trim() : '';
  if (!location) return res.json(payload({ error: 'No location configured' }));

  try {
    let coords: Coords | null;
    const m = location.match(LATLON_RE);
    if (m) {
      coords = { lat: parseFloat(m[1]), lon: parseFloat(m[2]), name: location };
    } else {
      coords = await geocode(location);
      if (!coords) return res.json(payload({ error: `Location not found: ${location}` }));
    }

    const resp = await fetch(
      `${WU_URL}?latitude=${coords.lat}&longitude=${coords.lon}`,
      { headers: { 'x-zomato-api-key': apiKey }, signal: AbortSignal.timeout(4000) },
    );
    const body: any = resp.ok ? await resp.json() : null;
    const data = body?.locality_weather_data;
    if (!resp.ok || body?.status !== '200' || !data) {
      return res.json(payload({ area: coords.name, error: `No weather station near ${coords.name}` }));
    }

    const windMs = num(data.wind_speed);
    const pm25 = num(data.aqi_pm_2_point_5);
    return res.json(payload({
      area: coords.name,
      temperature: num(data.temperature),
      humidity: num(data.humidity) === null ? null : Math.round(data.humidity),
      wind_speed_kmh: windMs === null ? null : round1(windMs * 3.6),
      wind_direction: compass(num(data.wind_direction)),
      rain_intensity: num(data.rain_intensity),
      rain_accumulation: num(data.rain_accumulation),
      rain_status: rainStatus(num(data.rain_intensity)),
      aqi_pm25: pm25 === null ? null : Math.round(pm25),
      aqi_pm10: num(data.aqi_pm_10) === null ? null : Math.round(data.aqi_pm_10),
      aqi_label: aqiLabel(pm25),
    }));
  } catch {
    return res.json(payload({ error: 'Weather fetch failed' }));
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no output.

- [ ] **Step 3: Verify locally against the live APIs**

Run (from repo root; key comes from trmnl.env):

```bash
set -a; source trmnl.env; set +a
npx vercel dev --listen 3000 &
sleep 8
curl -s 'http://localhost:3000/api/weather?location=12.977,77.641' ; echo
curl -s 'http://localhost:3000/api/weather?location=Indiranagar,%20Bengaluru' ; echo
curl -s 'http://localhost:3000/api/weather?location=Atlantis%20Nowhere' ; echo
curl -s 'http://localhost:3000/api/weather' ; echo
kill %1
```

Expected, in order:
1. Real values: `"temperature": <number>`, `"rain_status": "No rain"` (or similar), `"error": null`. AQI fields may be null — that's fine.
2. Same shape with `"area": "Indiranagar"` (geocoded).
3. `"error": "Location not found: Atlantis Nowhere"`, all data null.
4. `"error": "No location configured"`.

If `vercel dev` demands project linking, run the curls against the deployed URL after Task 2 instead — note it and move on.

- [ ] **Step 4: Commit and push (auto-deploys)**

```bash
git add api/weather.ts
git commit -m "Add weather endpoint backed by Weather Union"
git push
```

---

### Task 2: Deployed environment

**Files:** none (Vercel dashboard/CLI + TRMNL dashboard).

**Interfaces:**
- Consumes: deployed `api/weather.ts` from Task 1.
- Produces: live polling URL `https://<vercel-project>.vercel.app/api/weather?location={{ location }}` for Task 3; `TRMNL_MCP_API_KEY` in `trmnl.env`.

- [ ] **Step 1: Set the Vercel env var**

Preferred (CLI): `npx vercel env add WEATHER_UNION_API_KEY production` and paste the key from `trmnl.env` when prompted, then `npx vercel redeploy` (env changes need a redeploy). Fallback: Vercel dashboard → project → Settings → Environment Variables.

- [ ] **Step 2: Verify the deployed endpoint**

Run: `curl -s 'https://<vercel-project>.vercel.app/api/weather?location=12.977,77.641'`
Expected: real weather JSON, `"error": null`. (Find the exact domain via `npx vercel ls` or the dashboard.)

- [ ] **Step 3 (user, dashboard): Create the plugin shell**

In TRMNL → Plugins → Private Plugin → New:
- Name: `Weather`, Strategy: **Polling**
- Polling URL: `https://<vercel-project>.vercel.app/api/weather?location={{ location }}`
- Form Fields (YAML):

```yaml
- keyname: location
  field_type: string
  name: Location
  description: Area or coordinates to show weather for
  help_text: 'Examples: Indiranagar, Bengaluru — or lat,long like 12.97,77.64'
  placeholder: Indiranagar, Bengaluru
  required: true
```

- Save, fill in your location value, then generate the plugin's **MCP API key** from its settings page.

- [ ] **Step 4: Swap the MCP key and restart**

Replace `TRMNL_MCP_API_KEY` in `trmnl.env` with the new key; restart the Claude Code session so the trmnl MCP server rebinds to this plugin. Confirm via an MCP tool call (e.g. read current markup/settings) that it's the Weather plugin.

---

### Task 3: Markup via MCP

**Files:** none yet (dashboard is source of truth; synced in Task 4).

**Interfaces:**
- Consumes: merge variables from Task 1's JSON (`area`, `temperature`, `humidity`, `wind_speed_kmh`, `wind_direction`, `rain_accumulation`, `rain_status`, `aqi_pm25`, `aqi_pm10`, `aqi_label`, `updated_at`, `error`).
- Produces: live full-screen markup in the TRMNL dashboard.

- [ ] **Step 1: Force a data refresh via MCP** so real merge variables are available to the editor.

- [ ] **Step 2: Write the markup via the MCP `write_markup` tool** (full-screen layout only). Structure — CLAUDE.md flex pattern, framework classes only, no custom fonts:

```liquid
<div class="view view--full">
  <div class="content-container" style="flex-direction: column;">
    {% if error %}
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <span class="title title--small">Weather unavailable</span>
        <span class="description">{{ error }}</span>
      </div>
    {% else %}
      <div style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 24px;">
        <span class="value value--xxlarge">{{ temperature }}°</span>
        <div style="display: flex; flex-direction: column;">
          <span class="title">{{ area }}</span>
          {% if rain_status %}<span class="description">{{ rain_status }}</span>{% endif %}
        </div>
      </div>
      <div style="display: flex; justify-content: space-around; flex-shrink: 0;">
        {% if humidity %}<div style="text-align: center;"><span class="value value--small">{{ humidity }}%</span><br><span class="label">Humidity</span></div>{% endif %}
        {% if wind_speed_kmh %}<div style="text-align: center;"><span class="value value--small">{{ wind_speed_kmh }}</span><br><span class="label">km/h {{ wind_direction }}</span></div>{% endif %}
        {% if rain_accumulation and rain_accumulation > 0 %}<div style="text-align: center;"><span class="value value--small">{{ rain_accumulation }}mm</span><br><span class="label">Rain today</span></div>{% endif %}
        {% if aqi_pm25 %}<div style="text-align: center;"><span class="value value--small">{{ aqi_pm25 }}</span><br><span class="label">AQI · {{ aqi_label }}</span></div>{% endif %}
      </div>
    {% endif %}
  </div>
  <div class="title_bar">
    <span class="title">Weather</span>
    <span class="instance">{{ updated_at }} IST</span>
  </div>
</div>
```

(Adapt to the actual MCP tool names/editor conventions found at execution time; e-ink layout iteration is expected here — this block is the starting point, not a pixel-perfect contract. Note Liquid truthiness: `0` is truthy in Liquid, so `{% if humidity %}` hides only `null` — which is the intent; a genuine 0 reading should still display, except rain accumulation which has an explicit `> 0` check.)

- [ ] **Step 3: Render-verify.** Force refresh via MCP, view the rendered screen (MCP preview or dashboard). Check: temperature legible from across a room, tiles evenly spaced, no clipping, title_bar intact.

- [ ] **Step 4: Error-state verify.** Temporarily set the plugin's `location` field to `Atlantis Nowhere` in the dashboard, force refresh — expect the "Weather unavailable / Location not found" screen. Restore the real location after.

---

### Task 4: Sync to git

**Files:**
- Create: `plugins/weather/markup.liquid`
- Create: `plugins/weather/README.md`

**Interfaces:**
- Consumes: final markup from Task 3 (pulled via MCP).

- [ ] **Step 1: Pull final markup via MCP** and write it verbatim to `plugins/weather/markup.liquid`.

- [ ] **Step 2: Write `plugins/weather/README.md`**

```markdown
# weather — hyperlocal Indian weather (Weather Union)

Current conditions + AQI for one configured location, from Zomato's Weather
Union station network (weatherunion.com). Current readings only — Weather
Union has no forecast. India only.

- **Data source:** `api/weather.ts`, deployed at `https://<vercel-project>.vercel.app/api/weather`
- **Strategy:** Polling — URL carries `?location={{ location }}` from the plugin's Location form field
- **Auth:** `WEATHER_UNION_API_KEY` env var on Vercel (free key from weatherunion.com)

## Location field

Set on the plugin settings page. Accepts either:

| Form | Example |
|---|---|
| Area, City | `Indiranagar, Bengaluru` |
| lat,long | `12.97,77.64` |

Area names are geocoded via Open-Meteo (top hit wins; falls back to the
part before the comma). Weather Union then maps coordinates to the nearest
station — hyperlocal, so the specific area matters more than the city.

## Notes

- **Nullable everything:** stations report subsets (rain-only stations
  exist; AQI is patchy). Missing values drop their tile from the screen
  instead of rendering blanks.
- **Errors render on-screen** ("Location not found: …", "No weather station
  near …") — the endpoint always returns HTTP 200 so TRMNL doesn't show a
  stale screen.
- **markup.liquid** here is a version-controlled copy; the dashboard's Edit
  Markup is the actual source TRMNL renders from.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/weather/
git commit -m "Add weather plugin markup and README"
git push
```

---

## Self-Review (done at write time)

- **Spec coverage:** settings field → Task 2 Step 3; endpoint incl. parsing/geocode/derivations/errors/caching → Task 1; markup incl. nullable tiles + error state → Task 3; lifecycle/sync → Tasks 2 & 4; prerequisites (API key) already satisfied (key saved to trmnl.env, verified live 2026-07-18).
- **Placeholders:** `<vercel-project>` is deliberate — matches the existing stocks README convention; resolved at execution via `npx vercel ls`.
- **Type consistency:** merge variable names in Task 3's Liquid match Task 1's `WeatherPayload` field names exactly.
