/**
 * Stonx unified stream client helpers for the marketing site.
 * Wire protocol is implemented by Stonx (see their `server/routes/ws/stream.ts`); this file only types and serializes messages.
 */

export const STONX_STREAM_URL_DEFAULT = 'wss://stonx.app/ws/stream'

/** Matches Stonx app client (`useStreamStore`): 30s ping, stale detection beyond ~90s without pong. */
export const STONX_STREAM_PING_INTERVAL_MS = 30_000

export type StonxStreamOutbound =
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] }
  | { type: 'ping' }

/** One row inside `price_update.data` (server may add fields over time). */
export interface StonxPriceRow {
  symbol: string
  price: number
  change: number | null
  changePercent: number | null
  lastUpdated: number
  dayVolume?: number
  high24h?: number
  low24h?: number
  vwap?: number
  openPrice?: number
}

export type StonxStreamInbound =
  | { type: 'connected'; message?: string; timestamp: number }
  | { type: 'price_update'; data: StonxPriceRow[]; timestamp: number }
  | { type: 'pong' }
  | { type: 'error'; detail: Record<string, unknown> }
  | { type: 'subscribed_all'; message?: string; timestamp: number }
  | { type: 'unsubscribed_all'; message?: string; timestamp: number }
  | { type: 'realtime_event'; event: Record<string, unknown>; timestamp: number }

export function stonxSubscribeJson(channels: string[]): string {
  return JSON.stringify({ type: 'subscribe', channels } satisfies StonxStreamOutbound)
}

export function stonxUnsubscribeJson(channels: string[]): string {
  return JSON.stringify({ type: 'unsubscribe', channels } satisfies StonxStreamOutbound)
}

export function stonxPingJson(): string {
  return JSON.stringify({ type: 'ping' } satisfies StonxStreamOutbound)
}

function parsePriceRow(x: unknown): StonxPriceRow | null {
  if (typeof x !== 'object' || x === null) return null
  const r = x as Record<string, unknown>
  if (typeof r.symbol !== 'string' || typeof r.price !== 'number') return null
  const change = r.change
  const changePercent = r.changePercent
  const lastUpdated = r.lastUpdated
  return {
    symbol: r.symbol,
    price: r.price,
    change: typeof change === 'number' || change === null ? change : null,
    changePercent: typeof changePercent === 'number' || changePercent === null ? changePercent : null,
    lastUpdated: typeof lastUpdated === 'number' ? lastUpdated : Date.now(),
    dayVolume: typeof r.dayVolume === 'number' ? r.dayVolume : undefined,
    high24h: typeof r.high24h === 'number' ? r.high24h : undefined,
    low24h: typeof r.low24h === 'number' ? r.low24h : undefined,
    vwap: typeof r.vwap === 'number' ? r.vwap : undefined,
    openPrice: typeof r.openPrice === 'number' ? r.openPrice : undefined,
  }
}

/**
 * Narrow a parsed JSON value to a known inbound message shape.
 * Unknown `type` strings return null (caller may log or ignore).
 */
export function parseStonxStreamMessage(data: unknown): StonxStreamInbound | null {
  if (typeof data !== 'object' || data === null) return null
  const o = data as Record<string, unknown>
  const type = o.type
  if (type === 'connected' && typeof o.timestamp === 'number') {
    return {
      type: 'connected',
      message: typeof o.message === 'string' ? o.message : undefined,
      timestamp: o.timestamp,
    }
  }
  if (type === 'pong') {
    return { type: 'pong' }
  }
  if (type === 'price_update' && Array.isArray(o.data) && typeof o.timestamp === 'number') {
    const rows = o.data.map(parsePriceRow).filter((r): r is StonxPriceRow => r !== null)
    return { type: 'price_update', data: rows, timestamp: o.timestamp }
  }
  if (type === 'error') {
    return { type: 'error', detail: o }
  }
  if (type === 'subscribed_all' && typeof o.timestamp === 'number') {
    return {
      type: 'subscribed_all',
      message: typeof o.message === 'string' ? o.message : undefined,
      timestamp: o.timestamp,
    }
  }
  if (type === 'unsubscribed_all' && typeof o.timestamp === 'number') {
    return {
      type: 'unsubscribed_all',
      message: typeof o.message === 'string' ? o.message : undefined,
      timestamp: o.timestamp,
    }
  }
  if (
    type === 'realtime_event' &&
    typeof o.timestamp === 'number' &&
    typeof o.event === 'object' &&
    o.event !== null
  ) {
    return {
      type: 'realtime_event',
      event: o.event as Record<string, unknown>,
      timestamp: o.timestamp,
    }
  }
  return null
}
