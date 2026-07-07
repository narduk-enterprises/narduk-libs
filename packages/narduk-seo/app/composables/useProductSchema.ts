/**
 * useProductSchema — typed wrapper around nuxt-schema-org for Product JSON-LD.
 */

import { defineProduct, useSchemaOrg } from '#imports'

interface ProductOptions {
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder' | 'Discontinued'
  brand?: string
  description?: string
  image?: string | string[]
  itemCondition?: 'NewCondition' | 'UsedCondition' | 'RefurbishedCondition'
  mpn?: string
  name: string
  price?: number
  priceCurrency?: string
  ratingValue?: number
  reviewCount?: number
  seller?: { name: string; url?: string }
  sku?: string
  url?: string
}

export function useProductSchema(options: ProductOptions) {
  const {
    name,
    description,
    image,
    brand,
    sku,
    mpn,
    price,
    priceCurrency = 'USD',
    availability,
    itemCondition,
    url,
    seller,
    ratingValue,
    reviewCount,
  } = options

  useSchemaOrg([
    defineProduct({
      name,
      description,
      image,
      url,
      ...(brand && { brand: { '@type': 'Brand' as const, name: brand } }),
      ...(sku && { sku }),
      ...(mpn && { mpn }),
      ...(itemCondition && { itemCondition: `https://schema.org/${itemCondition}` }),
      ...(seller && {
        seller: { '@type': 'Organization' as const, name: seller.name, url: seller.url },
      }),
      ...(price !== undefined && {
        offers: {
          '@type': 'Offer' as const,
          price: price.toString(),
          priceCurrency,
          ...(availability && { availability: `https://schema.org/${availability}` }),
        },
      }),
      ...(ratingValue !== undefined &&
        reviewCount !== undefined && {
          aggregateRating: {
            '@type': 'AggregateRating' as const,
            ratingValue,
            reviewCount,
          },
        }),
    }),
  ])
}
