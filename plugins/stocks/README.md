# stocks — Indian markets (NSE / BSE)

Stock prices for Indian exchanges plus NIFTY 50 / SENSEX indices. Modeled 1:1 on TRMNL's native `stock_price` plugin (usetrmnl/plugins, `lib/stock_price/`) — same response shape (`tickers`, `currency_symbol`, `currency_separator`), same invalid-symbol degradation, same count-adaptive layout — so this work can be contributed upstream later.

- **Data source:** `api/stocks.ts`, deployed at `https://<vercel-project>.vercel.app/api/stocks`
- **Strategy:** Polling
- **Quotes from:** Yahoo Finance chart API (unofficial, no key). INR prices.

## Configuring the watchlist

Symbols go in the polling URL's query param — change the watchlist in the TRMNL dashboard, no redeploy needed:

```
https://<vercel-project>.vercel.app/api/stocks?symbols=RELIANCE.NS,TCS.NS,^NSEI
```

- Up to **12 symbols** (matches the native plugin's limit; also the full-screen layout max).
- Default when the param is absent: `^NSEI, ^BSESN, RELIANCE.NS, TCS.NS, HDFCBANK.NS, INFY.NS`.

## Symbol forms

| Kind | Form | Example |
|---|---|---|
| NSE equity | `NAME.NS` | `RELIANCE.NS` |
| BSE equity | `NAME.BO` (name form **only**) | `RELIANCE.BO` |
| NIFTY 50 | `^NSEI` | |
| SENSEX | `^BSESN` | |

**Numeric BSE scrip codes (e.g. `500325.BO`) are not supported** — Yahoo serves stale/broken data for them, so the endpoint rejects them up front. Unknown or failed symbols render degraded (`SYMBOL_NOT_SUPPORTED`, ₹0) instead of failing the whole screen — same behavior as the native plugin.

## Notes

- **After hours** (NSE/BSE trade 09:15–15:30 IST): price is the last close and change reflects the last completed session — standard ticker behavior.
- **Digit grouping is western** (`145,000`, not `1,45,000`): `price` stays numeric to mirror the native plugin's shape; formatting happens in markup via `number_with_delimiter`.
- **markup.liquid** here is a version-controlled copy; the dashboard's Edit Markup is the actual source TRMNL renders from.
