import { getHeader } from 'h3'

import type { H3Event } from 'h3'

// The visitor's approximate location, from whichever Cloudflare signal the
// runtime actually exposes.
//
// Two independent implementations of this existed before extraction
// (riverstatus `server/api/v1/location/approximate.get.ts`, borderwaitstat-us
// `server/api/geo/ip.get.ts`) reading two different Cloudflare signals:
//
//   - Nitro's `cloudflare_module` preset puts the Workers request's `cf`
//     object on `event.context.cloudflare.request.cf` (some runtimes surface
//     it at `.cf` directly) -- always populated on a real Cloudflare
//     deployment, no dashboard configuration required.
//   - The `cf-ip*` request headers (`CF-IPCity`, `CF-IPCountry`,
//     `CF-IPLatitude`, `CF-IPLongitude`, `CF-Region`) that Cloudflare adds
//     only when a zone has "Add visitor location headers" turned on --
//     useful behind a proxy or test harness that sets headers but does not
//     populate the Workers `cf` object.
//
// This reads the request-`cf` object first and falls back to the headers, so
// an app on either signal (or both) gets the same shape back.
//
// narduk-libs#76 Wave 2 "Cloudflare approximate IP location helper".

/** The public shape a route hands back for a visitor's approximate location. */
export interface ApproximateLocation {
  /**
   * The city Cloudflare resolved, e.g. `"Austin"`. Present only when
   * {@link ReadApproximateLocationOptions.includeCityRegion} is set and
   * Cloudflare provided one.
   */
  city?: string
  /** A short human-readable label, e.g. `"Austin, TX"` or `"US"`. */
  label: string
  lat: number
  lon: number
  /**
   * The ISO 3166-2 region code Cloudflare resolved, e.g. `"TX"`. Present only
   * when {@link ReadApproximateLocationOptions.includeCityRegion} is set and
   * the Workers request `cf` object carried one, or the `cf-region-code`
   * header (the "Add visitor location headers" managed transform) did.
   */
  regionCode?: string
  source: 'ip'
}

export interface ReadApproximateLocationOptions {
  /**
   * Also return `city` and `regionCode` when Cloudflare provides them, for a
   * route that needs the parts and not only the joined `label`. Off by
   * default so a route that returns the helper's result as its body keeps the
   * same JSON.
   */
  includeCityRegion?: boolean
}

interface CloudflareLocationFields {
  city?: string
  country?: string
  latitude?: string
  longitude?: string
  region?: string
  regionCode?: string
  /**
   * `cf-region-code`, kept apart from `regionCode` so the header fallback's
   * `label` still reads the region name, as it did before this was read.
   */
  regionCodeHeader?: string
}

function readCloudflareRequestContext(event: H3Event): CloudflareLocationFields | undefined {
  const cloudflareContext = event.context.cloudflare as
    { cf?: CloudflareLocationFields; request?: { cf?: CloudflareLocationFields } } | undefined
  return cloudflareContext?.request?.cf ?? cloudflareContext?.cf
}

function readCloudflareLocationHeaders(event: H3Event): CloudflareLocationFields | undefined {
  const latitude = getHeader(event, 'cf-iplatitude')
  const longitude = getHeader(event, 'cf-iplongitude')
  if (latitude === undefined && longitude === undefined) return undefined

  return {
    city: getHeader(event, 'cf-ipcity'),
    country: getHeader(event, 'cf-ipcountry'),
    latitude,
    longitude,
    region: getHeader(event, 'cf-region'),
    regionCodeHeader: getHeader(event, 'cf-region-code'),
  }
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function toApproximateLocation(
  fields: CloudflareLocationFields | undefined,
  options: ReadApproximateLocationOptions,
): ApproximateLocation | null {
  const lat = Number(fields?.latitude)
  const lon = Number(fields?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const label = [fields?.city, fields?.regionCode || fields?.region].filter(Boolean).join(', ')
  const location: ApproximateLocation = {
    label: label || fields?.country || 'approximate location',
    lat,
    lon,
    source: 'ip',
  }
  if (options.includeCityRegion) {
    const city = nonBlank(fields?.city)
    const regionCode = nonBlank(fields?.regionCode) ?? nonBlank(fields?.regionCodeHeader)
    if (city) location.city = city
    if (regionCode) location.regionCode = regionCode
  }
  return location
}

/**
 * The visitor's approximate location for this request, or `null` when
 * neither Cloudflare signal carries usable coordinates (a request that
 * reached the app outside Cloudflare's edge -- local dev without a Cloudflare
 * dev-proxy, for instance).
 */
export function readApproximateLocation(
  event: H3Event,
  options: ReadApproximateLocationOptions = {},
): ApproximateLocation | null {
  return (
    toApproximateLocation(readCloudflareRequestContext(event), options) ??
    toApproximateLocation(readCloudflareLocationHeaders(event), options)
  )
}
