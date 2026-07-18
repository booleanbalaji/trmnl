# Weather Screen — Design

## Purpose

A full-screen TRMNL plugin showing hyperlocal current weather (and AQI where available) for a user-configured location in India, powered by Weather Union (Zomato's free weather station network, weatherunion.com).

## Key constraints discovered

- **No auto-location**: TRMNL polls from its cloud; the device has no GPS. Location must be configured, not detected. Decision: a `location` custom form field on the TRMNL plugin settings page (string — area name or `lat,long`), matching how TRMNL's native Weather recipe handles location. No self-hosted settings page, no datastore.
- **Weather Union is current-conditions only** — no forecast. India only; accuracy depends on proximity to a Zomato weather station. Some stations are rain-gauge-only; AQI (PM2.5/PM10) exists only in some localities. Every data field is therefore nullable.
- **Auth**: `x-zomato-api-key` header; free tier ~1000 calls/day. Key lives in Vercel env var `WEATHER_UNION_API_KEY` (never committed).

## Architecture

Same polling lifecycle as the stocks plugin:

```
TRMNL cloud ──poll──▶ api/weather.ts?location={{ location }}   (Vercel)
                          1. parse location field (lat,long or area name)
                          2. geocode area names via Open-Meteo geocoding API (free, no key)
                          3. GET weatherunion.com get_weather_data (lat/long + API key header)
                          ▼
                      flat JSON merge variables ──▶ Liquid markup (via MCP) ──▶ e-ink PNG
```

## Components

### Plugin settings (TRMNL dashboard)

- Custom form field `location`, type `string`, required. Help text: accepts `Area, City` (e.g. `Indiranagar, Bengaluru`) or `lat,long` (e.g. `12.97,77.64`). TRMNL interpolates it into the polling URL as `?location={{ location }}`.

### api/weather.ts

- **Input parsing**: if `location` matches `^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$`, treat as lat,long. Otherwise geocode via `https://geocoding-api.open-meteo.com/v1/search?name=<query>&count=1`; take the top result's lat/long and name. Missing/empty param → error response (no default location).
- **Weather fetch**: `GET https://www.weatherunion.com/gw/weather/external/v0/get_weather_data?latitude=..&longitude=..` with `x-zomato-api-key: $WEATHER_UNION_API_KEY`. Timeout via `AbortSignal` (4s per upstream call), overall handler well inside Vercel's 10s budget.
- **Response shape** (all data fields nullable):

  ```json
  {
    "area": "Indiranagar",
    "temperature": 27.4,
    "humidity": 62,
    "wind_speed_kmh": 8.2,
    "wind_direction": "NE",
    "rain_intensity": 0,
    "rain_accumulation": 1.2,
    "rain_status": "No rain",
    "aqi_pm25": 48,
    "aqi_pm10": 61,
    "aqi_label": "Satisfactory",
    "updated_at": "7:42 AM",
    "error": null
  }
  ```

- **Derivations in TypeScript, not Liquid**: compass text from wind degrees; `rain_status` bands from rain_intensity (mm/min): 0 → "No rain", <0.25 → "Light rain", <1 → "Moderate rain", ≥1 → "Heavy rain"; `aqi_label` from Indian AQI bands on PM2.5 (Good ≤30, Satisfactory ≤60, Moderate ≤90, Poor ≤120, Very Poor ≤250, Severe >250). Wind speed converted m/s → km/h.
- **Error handling**: geocode miss → `error: "Location not found"`; Weather Union non-200/device-not-found → `error: "No weather station near <area>"`; missing API key → `error: "API key not configured"`. Always HTTP 200 to TRMNL so the screen renders the error text instead of TRMNL showing a stale/broken screen.
- **Caching**: `Cache-Control: s-maxage=600, stale-while-revalidate=1200` — shields Weather Union and keeps usage far below the daily quota.

### Markup (plugins/weather/markup.liquid, edited via MCP)

- Full-screen layout only (`view--full`), standard `.view`/`.content-container`/`.title_bar` flex pattern from CLAUDE.md.
- Hero: large `value` temperature + `title` area name.
- Tile row: humidity, wind (speed + direction), rain status (+ accumulation when > 0), AQI (PM2.5 value + label). Each tile uses `value--xsmall` + `label`; a tile is omitted entirely (`{% if %}`) when its data is null.
- Error state: when `error` is present, render a centered `title--small` + `description` with the error message instead of the data layout.
- `title_bar` shows plugin name + `updated_at`.

## Plugin lifecycle steps

1. Write `api/weather.ts`, push to `main` (auto-deploys via Vercel). Set `WEATHER_UNION_API_KEY` in Vercel project env.
2. Create the Private Plugin in TRMNL dashboard: strategy = Polling, URL = `https://<vercel-app>/api/weather?location={{ location }}`, add the `location` form field.
3. Generate the plugin's MCP key → `trmnl.env`, restart session.
4. Build markup via MCP tools; iterate with force refresh.
5. Sync markup back to `plugins/weather/markup.liquid` + README with plugin ID/URLs.

## Prerequisites (user)

- Sign up at weatherunion.com for a free API key; add it to Vercel as `WEATHER_UNION_API_KEY`.

## Testing

No test framework (per project convention). Verification:
- `vercel dev` + curl: area name, `lat,long`, unknown place, empty param, missing key — confirm JSON/error shapes.
- Live: MCP force refresh, verify all tiles render, then temporarily point at a rain-only locality to confirm nullable tiles disappear cleanly.

## Out of scope

- Forecast data (Weather Union doesn't provide it).
- Multiple locations / multi-instance support beyond what TRMNL gives for free (each plugin instance has its own `location` field value — this Just Works).
- Half/quadrant layouts (full screen only for now).
- Fahrenheit (metric only; this is an India-only data source).
