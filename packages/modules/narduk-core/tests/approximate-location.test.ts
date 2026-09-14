import { describe, expect, it } from 'vitest'

import { readApproximateLocation } from '../runtime/server/utils/approximateLocation'

import type { H3Event } from 'h3'

function eventWithRequestCf(cf: Record<string, string>): H3Event {
  return {
    context: {
      cloudflare: {
        request: { cf },
      },
    },
    node: { req: { headers: {} } },
  } as unknown as H3Event
}

function eventWithDirectCf(cf: Record<string, string>): H3Event {
  return {
    context: {
      cloudflare: { cf },
    },
    node: { req: { headers: {} } },
  } as unknown as H3Event
}

function eventWithHeaders(headers: Record<string, string>): H3Event {
  return {
    context: {},
    node: { req: { headers } },
  } as unknown as H3Event
}

describe('readApproximateLocation', () => {
  it('reads the Workers request.cf object (Nitro cloudflare_module shape)', () => {
    const location = readApproximateLocation(
      eventWithRequestCf({
        city: 'Austin',
        country: 'US',
        latitude: '30.2672',
        longitude: '-97.7431',
        regionCode: 'TX',
      }),
    )

    expect(location).toEqual({
      label: 'Austin, TX',
      lat: 30.2672,
      lon: -97.7431,
      source: 'ip',
    })
  })

  it('also reads a direct .cf shape some runtimes surface', () => {
    const location = readApproximateLocation(
      eventWithDirectCf({
        country: 'US',
        latitude: '30.2672',
        longitude: '-97.7431',
        region: 'Texas',
      }),
    )

    expect(location).toMatchObject({ label: 'Texas', lat: 30.2672, lon: -97.7431, source: 'ip' })
  })

  it('falls back to country when no city or region is present', () => {
    const location = readApproximateLocation(
      eventWithRequestCf({ country: 'US', latitude: '30.2672', longitude: '-97.7431' }),
    )

    expect(location).toMatchObject({ label: 'US' })
  })

  it('falls back to a generic label when nothing else is present', () => {
    const location = readApproximateLocation(
      eventWithRequestCf({ latitude: '30.2672', longitude: '-97.7431' }),
    )

    expect(location).toMatchObject({ label: 'approximate location' })
  })

  it('returns null when request.cf carries no coordinates and there are no headers either', () => {
    expect(readApproximateLocation(eventWithRequestCf({ city: 'Austin' }))).toBeNull()
  })

  it('falls back to cf-ip* request headers when there is no request.cf at all', () => {
    const location = readApproximateLocation(
      eventWithHeaders({
        'cf-ipcity': 'Marfa',
        'cf-ipcountry': 'US',
        'cf-iplatitude': '30.3095',
        'cf-iplongitude': '-104.0177',
        'cf-region': 'Texas',
      }),
    )

    expect(location).toEqual({ label: 'Marfa, Texas', lat: 30.3095, lon: -104.0177, source: 'ip' })
  })

  it('prefers request.cf over headers when both are present', () => {
    const event = eventWithRequestCf({ city: 'Austin', latitude: '30.2672', longitude: '-97.7431' })
    ;(event as unknown as { node: { req: { headers: Record<string, string> } } }).node = {
      req: { headers: { 'cf-iplatitude': '0', 'cf-iplongitude': '0' } },
    }

    expect(readApproximateLocation(event)).toMatchObject({ lat: 30.2672, lon: -97.7431 })
  })

  it('returns null for a request with neither signal', () => {
    expect(readApproximateLocation(eventWithHeaders({}))).toBeNull()
  })
})
