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


