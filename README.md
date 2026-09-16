# Kite GTT Marker

Chrome extension for kite.zerodha.com.

- On `/orders/gtt`: puts 💼 before an **active** GTT row if its tradingsymbol
  also appears in your current holdings or positions.
- On `/holdings*`: puts 🚀 before a holding row if it has an active GTT.
- On `/positions*`: puts 🚀 before a position row if it has an active GTT.

## How auth works (no tokens stored anywhere)

The script runs inside your already-logged-in Kite tab. At call time it
reads the `enctoken` cookie the page itself already has and uses it to hit
Kite's own internal endpoints (`/oms/gtt/triggers`, `/oms/portfolio/holdings`,
`/oms/portfolio/positions`) with `credentials: 'include'`. Nothing is
hardcoded, cached, or sent anywhere outside kite.zerodha.com.

## Install

1. `chrome://extensions` -> enable Developer mode (top right).
2. "Load unpacked" -> select this `kite-gtt-marker` folder.
3. Open kite.zerodha.com and go to Positions / Holdings / GTT.

## Known limitation — table selectors are a best guess

I built the matching logic against Kite's real API responses, but I don't
have the live HTML of kite.zerodha.com's tables, so the DOM-matching code
assumes a fairly generic structure: `table tbody tr`, with the instrument
name living in the first `<td>`.

If icons don't show up:
1. Open DevTools console on the page — the script logs warnings
   (`[Kite GTT Marker] ...`) if the enctoken cookie isn't found or a
   request fails.
2. If auth is fine but icons still don't appear, right-click a row ->
   Inspect, and send me the row's HTML — I'll tighten the selector
   (`firstCell()` in content.js) to match the exact column Kite uses.

## Tuning

- `API_REFRESH_MS` in content.js (default 20s) — how often it re-polls Kite.
- `DOM_DEBOUNCE_MS` (default 250ms) — how fast it re-applies icons after the
  page re-renders (Kite tables re-render often on live price ticks).
