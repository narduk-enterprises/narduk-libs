import { describe, expect, it } from 'vitest'

import { sitemapUrlsFromListing } from '../shared/sitemapFromListing'

interface Listing {
  featured?: boolean
  slug: string
  updatedAt?: Date | string | number | null
}

const ALPHA = '/buoys/alpha'
const BETA = '/buoys/beta'

const listings: Listing[] = [
  { slug: 'alpha', updatedAt: new Date('2026-09-01T12:00:00.000Z') },
  { slug: 'beta', updatedAt: '2026-08-15' },
  { slug: 'gamma' },
]

describe('sitemapUrlsFromListing', () => {
  it('maps each item to a sitemap row with the built loc, in input order', () => {
    expect(sitemapUrlsFromListing(listings, { loc: (item) => `/buoys/${item.slug}` })).toEqual([
      { loc: ALPHA },
      { loc: BETA },
      { loc: '/buoys/gamma' },
    ])
  })

  it('normalises lastmod to an ISO string and omits missing or invalid values', () => {
    const rows = sitemapUrlsFromListing(
      [
        ...listings,
        { slug: 'delta', updatedAt: Date.parse('2026-07-04T00:00:00.000Z') },
        { slug: 'epsilon', updatedAt: 'not a date' },
        { slug: 'zeta', updatedAt: new Date(Number.NaN) },
        { slug: 'eta', updatedAt: '   ' },
        { slug: 'theta', updatedAt: null },
      ],
      { loc: (item) => `/buoys/${item.slug}`, lastmod: (item) => item.updatedAt },
    )

    expect(rows).toEqual([
      { loc: ALPHA, lastmod: '2026-09-01T12:00:00.000Z' },
      { loc: BETA, lastmod: '2026-08-15' },
      { loc: '/buoys/gamma' },
      { loc: '/buoys/delta', lastmod: '2026-07-04T00:00:00.000Z' },
      { loc: '/buoys/epsilon' },
      { loc: '/buoys/zeta' },
      { loc: '/buoys/eta' },
      { loc: '/buoys/theta' },
    ])
  })

  it('skips items whose loc builder returns an empty value', () => {
    const rows = sitemapUrlsFromListing(
      [{ slug: 'alpha' }, { slug: '' }, { slug: '   ' }, { slug: 'beta' }],
      {
        loc: (item) => (item.slug.trim() ? `/buoys/${item.slug}` : item.slug),
      },
    )
    const nullable = sitemapUrlsFromListing([{ slug: 'alpha' }, { slug: 'beta' }], {
      loc: (item) => (item.slug === 'alpha' ? undefined : null),
    })

    expect(rows).toEqual([{ loc: ALPHA }, { loc: BETA }])
    expect(nullable).toEqual([])
  })

  it('trims loc and dedupes by loc, keeping the first occurrence', () => {
    const rows = sitemapUrlsFromListing(
      [
        { slug: 'alpha', updatedAt: '2026-01-01' },
        { slug: 'beta' },
        { slug: 'alpha', updatedAt: '2026-02-02' },
      ],
      {
        loc: (item) => ` /buoys/${item.slug} `,
        lastmod: (item) => item.updatedAt,
      },
    )

    expect(rows).toEqual([{ loc: ALPHA, lastmod: '2026-01-01' }, { loc: BETA }])
  })

  it('applies changefreq and priority as constants or per-item builders', () => {
    const constant = sitemapUrlsFromListing(listings.slice(0, 1), {
      loc: (item) => `/buoys/${item.slug}`,
      changefreq: 'daily',
      priority: 0.8,
    })
    const perItem = sitemapUrlsFromListing([{ slug: 'alpha', featured: true }, { slug: 'beta' }], {
      loc: (item) => `/buoys/${item.slug}`,
      changefreq: (item) => (item.featured ? 'hourly' : undefined),
      priority: (item) => (item.featured ? 1 : 0.5),
    })

    expect(constant).toEqual([{ loc: ALPHA, changefreq: 'daily', priority: 0.8 }])
    expect(perItem).toEqual([
      { loc: ALPHA, changefreq: 'hourly', priority: 1 },
      { loc: BETA, priority: 0.5 },
    ])
  })

  it('passes the item index to the loc builder and accepts any iterable', () => {
    function* generate() {
      yield { slug: 'alpha' }
      yield { slug: 'beta' }
    }

    expect(
      sitemapUrlsFromListing(generate(), { loc: (item, index) => `/p/${index}/${item.slug}` }),
    ).toEqual([{ loc: '/p/0/alpha' }, { loc: '/p/1/beta' }])
  })

  it('returns an empty list for an empty or missing listing', () => {
    expect(sitemapUrlsFromListing([], { loc: () => '/x' })).toEqual([])
    expect(sitemapUrlsFromListing(null, { loc: () => '/x' })).toEqual([])
    expect(sitemapUrlsFromListing(undefined, { loc: () => '/x' })).toEqual([])
  })
})
