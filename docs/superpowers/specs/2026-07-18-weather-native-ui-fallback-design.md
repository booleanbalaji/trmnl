# Weather Native UI and Station Fallback Design

## Goal

Make the Weather Union screen resemble TRMNL's native weather plugin while remaining accurate to the data Weather Union provides. The screen must display the selected station's area name instead of coordinates, avoid overlapping text at every supported size, and fill missing readings from one nearby station.

## Scope

This change covers:

- the Weather Union API response and fallback behavior;
- the weather markup for full, half-horizontal, half-vertical, and quadrant views;
- automated tests for fallback selection and merging;
- rendered verification for complete, partial, long-area-name, and error payloads.

Forecast data and additional weather providers are out of scope.

## Data Flow

1. Resolve the configured location to the selected catalog station when possible.
2. Fetch Weather Union readings using the selected station's coordinates.
3. Return an error when the primary request fails because fallback is not intended to hide a provider outage.
4. Check the successful primary response for missing display fields.
5. If fields are missing, order other catalog stations by geographic distance from the selected station.
6. Try no more than the three nearest candidates.
7. Choose the first candidate that supplies at least one missing display field.
8. Fill every missing field available from that candidate, without consulting another fallback station or overwriting primary values.
9. Preserve the selected station's canonical name as `area`, even when fallback data is used.

The API will expose display-ready values plus `fallback_used: boolean` and
`fallback_station: string | null`, so the template does not need to implement
data logic.

## Station Distance and Fallback

Distance ordering will use a geographic distance calculation over catalog latitude and longitude. The selected station is excluded from candidates.

A candidate qualifies when its successful response contains at least one field that is missing from the primary response. Once a candidate qualifies, it becomes the only fallback source. Any fields absent from both sources remain null.

If a nearby request fails or contributes no missing value, the next candidate is tried. No more than three nearby requests are made. Free-text and raw-coordinate locations remain supported, but nearest-catalog fallback only runs when the selected location resolves to a catalog station.

When fallback contributes at least one value, `fallback_used` is true and
`fallback_station` contains that station's canonical name. Otherwise they are
false and null. The visible location remains the selected area. When borrowed
readings are displayed, the screen uses a compact `nearby` indicator rather
than replacing the location name.

## API Boundaries

The implementation will keep these responsibilities separate:

- station catalog helpers resolve stations and calculate ordered neighbors;
- Weather Union fetching retrieves and validates one station response;
- payload merging fills null primary values from one fallback response;
- the request handler coordinates resolution, primary fetch, bounded fallback, and the final response.

This separation allows distance ordering and merge behavior to be tested without network requests.

## UI Design

The visual direction is current conditions only, modeled after the structure and hierarchy of TRMNL's native weather plugin.

### Full

Use a wide grid with a large temperature block and a current-conditions block, followed by a row of up to three secondary metrics. Available secondary content is rain, AQI, and location or fallback context. The title bar contains the plugin name, selected area, and update time.

### Half Horizontal

Use one horizontal strip: temperature, two highest-priority current metrics, then the title bar. Remove secondary descriptions and lower-priority metrics before reducing legibility.

### Half Vertical

Stack temperature, current condition, and a compact two-column metric section. Keep the selected area in the title bar.

### Quadrant

Show temperature and one concise condition only. Secondary metrics are omitted.

Weather Union does not provide enough condition data to infer a truthful sunny, cloudy, or similar icon, so the screen will not display a fabricated condition icon.

## Overlap Prevention

Overlap prevention is a layout requirement, not a best-effort styling adjustment.

- Use TRMNL grid spans for proportional sections so content blocks cannot intrude into each other.
- Use framework typography classes for their intended purpose.
- Apply automatic fit-to-container behavior to large numeric values.
- Keep labels concise and omit unavailable metric blocks.
- Use smaller title-bar text for long area names.
- Reduce content by view size instead of shrinking the complete full-screen layout.
- Do not use custom CSS, viewport units, fixed positioning, or manually sized percentage columns.

Each view must pass screenshot inspection with no overflow or overlapping bounding boxes.

## Error States

- Missing configuration returns the existing configuration error.
- A failed primary request returns a weather-unavailable payload and does not trigger fallback.
- Failed fallback requests are skipped within the three-candidate limit.
- If no fallback contributes data, the primary payload is returned with remaining fields null.
- The template omits null metrics without leaving empty visual containers.
- The selected area's name remains visible in partial-data states.

## Testing

Automated tests will cover:

- nearest-station ordering and exclusion of the selected station;
- stable ordering for equal-distance candidates;
- the three-candidate request limit;
- selection of the first candidate that contributes a missing field;
- filling all available missing values from one fallback station;
- preservation of primary values;
- preservation of the selected area name;
- behavior when fallback requests fail or contribute nothing;
- no fallback for non-catalog free-text and coordinate locations;
- existing station lookup, city/station dropdown, and CORS behavior.

Rendered verification will cover all four view sizes with:

- a complete payload;
- a partial payload using nearby fallback;
- a partial payload with no useful fallback;
- a long selected area name;
- an error payload.

Completion requires no detected text overlap or overflow in any supported view.
