# AAPL Marketing Demo Brief

Build a new flagship marketing-site example that feels inspired by the density and confidence of the TradingView chart surface without copying TradingView 1:1.

## Goal

Add a dedicated `AAPL` example to the marketing site and make it the best showcase of the advanced capabilities already present in `narduk-charts`.

## Route And Placement

- Canonical route: `/docs/examples/aapl` on the **marketing site** Nuxt app (`narduk-enterprises/charts`).
- Implement the page in `apps/web/app/pages/docs/examples/aapl.vue` (client chart in `apps/web/app/components/examples/`).
- Redirect legacy `/examples/aapl` → `/docs/examples/aapl` via `routeRules` in `apps/web/nuxt.config.ts`.
- Link the demo from **Documentation → Examples** and keep candle/OHLC depth in **Showcase** (e.g. `/showcase/candle`).

## Visual Direction

Use the current [TradingView chart surface](https://www.tradingview.com/chart/) as interaction-density reference:

- clear symbol header
- compact status strip with price / change / session stats
- confident chart framing
- professional control density
- room for supporting data around the main chart

Do not clone TradingView branding or layout literally. Stay inside the established `narduk-charts` visual language and ship a distinctive, product-ready surface.

## Required `narduk-charts` Features To Showcase

The point of this page is to demonstrate the advanced features we already have in the library:

- `NardukCandleChart`
- `NardukChartStack`
- `NardukLineChart`
- linked viewport sync with `v-model:domain`
- linked study pane sync with `v-model:x-window`
- volume pane
- brush / minimap
- drag-to-zoom, wheel zoom, shift-pan, double-click reset
- crosshair
- last-price line
- session grid
- forming-bar highlight
- overlay slot usage
- drawing tools
- linear / log scale toggle
- computed study row such as RSI
- polished stats / HUD framing around the chart

## Data Source

Use the Stonx public market-data stream instead of exposing Polygon directly in the client.

**Canonical wire behavior** is defined by the Stonx server implementation (reference: `stonx-app-2026/server/routes/ws/stream.ts`). The `narduk-charts` package repo does not modify Stonx; the marketing site uses [`apps/web/app/utils/stonxStream.ts`](https://github.com/narduk-enterprises/charts) (paths relative to the charts app checkout) for types and JSON helpers.

Default stream URL:

- `wss://stonx.app/ws/stream`

Client messages:

- `{"type":"subscribe","channels":["price:AAPL"]}` — channel prefix `price:` + uppercase symbol (server normalizes).
- `{"type":"unsubscribe","channels":["price:AAPL"]}` on cleanup.
- `{"type":"ping"}` periodically (e.g. every 30s); server responds with `{"type":"pong"}`. Matches Stonx app `useStreamStore` keep-alive / stale detection.
- Debug-only on Stonx side: `subscribe_all` / `unsubscribe_all` (wildcard `price:*`) — not used by this demo.

Server → client (handle in the example):

- `connected` — e.g. `{ "type": "connected", "message": "Connected to Stonx Stream", "timestamp": <ms> }`
- `price_update` — `{ "type", "data": [ { symbol, price, change, changePercent, lastUpdated, ... } ], "timestamp" }`. Rows may include `dayVolume`, `high24h`, `low24h`, `vwap`, `openPrice` when available from cache.
- `pong`
- `error` (log and continue)
- Optional: `realtime_event` (db relay), research broadcasts — not used by the AAPL chart demo.

Observed live payload example:

```json
{
  "type": "price_update",
  "data": [
    {
      "symbol": "AAPL",
      "price": 254,
      "change": null,
      "changePercent": null,
      "lastUpdated": 1774562115772
    }
  ],
  "timestamp": 1774562171041
}
```

## Implementation Expectations

- Show `AAPL` and `Apple Inc.` prominently.
- Use real live updates from the stream for quote / header / status elements.
- Seed the chart with plausible deterministic historical candles, then let live updates move the latest state forward.
- If the WebSocket is unavailable, degrade gracefully with the seeded dataset and an explicit offline / delayed badge instead of a broken UI.
- Keep the page responsive and credible on desktop and mobile.
- Avoid leaking any secret API key into the marketing-site client bundle.

## Marketing-Site Composition

Aim for a flagship demo page with:

- symbol header
- company / venue context
- real-time price strip
- main candle chart
- lower study pane
- sidecar insight cards or watchlist-style context
- clear CTA back into **Docs → Examples** and **Showcase**

## Quality Bar

- production-ready polish, not a rough demo
- no placeholder copy
- no broken loading states
- no hydration or runtime errors
- no regressions to existing examples
- follow existing Vue 3 Composition API patterns used in the repo

