# Weather Station Selection — Design

## Purpose

Replace unreliable free-text location geocoding with a city-first, station-second
selector backed by Weather Union's published locality catalog. Keep existing
coordinate and place-name inputs working for backward compatibility.

## Station catalog

Store Weather Union's published stations in a version-controlled data file. Each
station contains:

- city name
- locality name
- Weather Union locality ID
- latitude and longitude
- device type

Locality IDs are the stable values passed between plugin settings and the weather
endpoint. User-facing labels remain the published locality names.

## Location options endpoint

Add `api/weather-locations.ts` as the public data source for TRMNL's chained
`xhrSelect` fields.

- A request without a city returns all cities as label/value option objects.
- A request with a city returns that city's stations as label/value option
  objects.
- Cities and stations are sorted alphabetically.
- Unknown cities return an empty option array.
- The endpoint accepts GET requests because the dropdown URLs interpolate the
  selected city directly.

## Weather endpoint resolution

Update `api/weather.ts` to resolve locations in this order:

1. Weather Union locality ID, matched case-insensitively.
2. Exact Weather Union locality name, matched case-insensitively.
3. Latitude/longitude coordinates.
4. Existing Open-Meteo free-text geocoding fallback.

Catalog matches use the station's published locality name as the response
`area`, avoiding coordinate strings on the rendered screen.

## Plugin settings

Replace the free-text Location field with two chained dynamic dropdowns:

1. `city`: an `xhrSelect` populated by the location options endpoint.
2. `station`: an `xhrSelect` that depends on `city` and requests only stations
   in the selected city.

The polling URL sends `station` as its `location` query parameter. During
migration it falls back to the existing `location` value, then to the current
Bannerghatta Road coordinates, so weather data keeps flowing until a station is
selected and saved.

## Rollout

The location options endpoint and station-aware weather endpoint must be
deployed before the plugin settings reference them. After deployment:

1. Verify city and station option responses from production.
2. Update the custom fields and polling URL through TRMNL.
3. Select Bengaluru and Bannerghatta Road, Bangalore.
4. Force-refresh plugin data and verify the canonical area and current weather.
5. Verify the existing full-screen markup still renders without overflow.

## Error handling

- Missing location returns the existing display-ready error payload.
- Unknown locality IDs continue to the existing free-text geocoder, preserving
  backward compatibility.
- Unknown cities in the options endpoint return an empty array rather than an
  error object, as required by `xhrSelect`.
- Weather Union and geocoding failures retain the existing HTTP 200 error
  payload behavior so TRMNL can render the failure state.

## Verification

- TypeScript compilation succeeds.
- Location options return the complete sorted city list.
- Bengaluru options include `ZWL004924` labeled
  `Bannerghatta Road, Bangalore`.
- `ZWL004924`, its exact locality name, and its coordinates resolve to the same
  station coordinates.
- Existing arbitrary place-name geocoding still works.
- Production polling returns non-empty weather variables after the dropdown
  migration.
- The full-screen screenshot has no overflow or layout regression.

## Out of scope

- Automatically updating the catalog from the PDF.
- Forecast data, which Weather Union does not provide.
- Changing the weather screen layout.
