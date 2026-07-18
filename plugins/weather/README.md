# weather — hyperlocal Indian weather (Weather Union)

Current conditions + AQI for one configured location, from Zomato's Weather
Union station network (weatherunion.com). Current readings only — Weather
Union has no forecast. India only.

- **Data source:** `api/weather.ts`, deployed at `https://trmnl-cyan.vercel.app/api/weather`
- **Strategy:** Polling — URL carries `?location={{ location }}` from the plugin's Station form field
- **Auth:** `WEATHER_UNION_API_KEY` env var on Vercel (free key from weatherunion.com)
- **Dashboard plugin:** Weather Union (Private Plugin)

## Location setup

On the plugin settings page, choose a **City** and then a **Station**. This is
the preferred setup path. The station field displays a locality name but stores
Weather Union's locality ID (for example, Bannerghatta Road, Bangalore stores
`ZWL004924`); that stored ID is sent as the `location` query parameter.

The city and station options come from the provided Weather Union PDF station
catalog. The PDF is the provenance for the checked-in catalog data; it is not
read at runtime.

For backward compatibility, the weather API also accepts coordinates and free
text directly:

| API input | Example |
|---|---|
| lat,long | `12.97,77.64` |
| Area, City | `Indiranagar, Bengaluru` |

Free-text area names are geocoded via Open-Meteo (top hit wins; falls back to
the part before the comma). Weather Union then maps coordinates to the nearest
station. These API inputs remain supported for existing callers, but new plugin
configuration should use City → Station so the selected locality is
deterministic.

## Screen layout

The screen shows **current conditions only** — no forecast and no invented
weather icon (Weather Union does not provide enough condition data to infer
one truthfully). The selected station's area name appears in the title bar;
coordinates are never shown as the location label.

## Nearby-station fallback

Some stations omit readings (especially AQI). When the selected location is a
**catalog station** (City → Station / locality ID) and the primary response
is missing display fields, the API tries up to **three** nearest catalog
neighbors and fills missing values from the **first** station that can help.
Primary values are never overwritten. The visible `area` stays the selected
station's name; the payload sets `fallback_used` / `fallback_station`, and
the screen marks borrowed context with a compact `nearby` indicator.

Fallback does **not** run for free-text or raw-coordinate locations, and it
does **not** run when the primary Weather Union request itself fails — those
still surface as on-screen errors.

## Notes

- **Nullable everything:** stations report subsets (rain-only stations
  exist; AQI is patchy). Missing values drop their tile from the screen
  instead of rendering blanks.
- **Errors render on-screen** ("Location not found: …", "No weather station
  near …") — the endpoint always returns HTTP 200 so TRMNL doesn't show a
  stale screen.
- **markup.liquid** here is a version-controlled copy; the dashboard's Edit
  Markup is the actual source TRMNL renders from.
