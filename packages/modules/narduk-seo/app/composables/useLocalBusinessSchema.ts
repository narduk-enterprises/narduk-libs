/**
 * useLocalBusinessSchema — typed wrapper around nuxt-schema-org for LocalBusiness JSON-LD.
 */

import { useSchemaOrg } from '#imports'

export interface LocalBusinessOptions {
  address: {
    addressCountry?: string
    addressLocality: string
    addressRegion: string
    postalCode: string
    streetAddress: string
  }
  description?: string
  email?: string
  geo?: {
    latitude: number
    longitude: number
  }
  image?: string
  name: string
  /**
   * schema.org `openingHours` text form, one entry per rule, e.g.
   * `['Mo-Fr 09:00-17:00', 'Sa 10:00-14:00']`. Emitted as `openingHours`;
   * `openingHoursSpecification` takes structured objects, not strings (#944).
   */
  openingHours?: string[]
  priceRange?: string
  telephone?: string
  url?: string
}

export function useLocalBusinessSchema(options: LocalBusinessOptions) {
  const {
    name,
    description,
    image,
    telephone,
    email,
    address,
    geo,
    openingHours,
    priceRange,
    url,
  } = options

  useSchemaOrg([
    {
      '@type': 'LocalBusiness' as const,
      name,
      description,
      image,
      telephone,
      email,
      url,
      priceRange,
      address: {
        '@type': 'PostalAddress' as const,
        ...address,
        addressCountry: address.addressCountry ?? 'US',
      },
      ...(geo && {
        geo: {
          '@type': 'GeoCoordinates' as const,
          latitude: geo.latitude,
          longitude: geo.longitude,
        },
      }),
      ...(openingHours?.length && { openingHours }),
    },
  ])
}
