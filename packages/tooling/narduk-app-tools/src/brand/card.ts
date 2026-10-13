import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { brandShortName } from './config.js'
import type { BrandConfig } from './config.js'
import { renderBrandCard } from './render.js'

export const SOCIAL_PREVIEW_CONFIG_PATH = 'Config/social-previews.json'

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The site host for the card's sign-off: the social inventory, then package.json. */
export function resolveSiteHost(root: string, brand: BrandConfig): string {
  const candidates: unknown[] = []
  const social = readJson(resolve(root, SOCIAL_PREVIEW_CONFIG_PATH))
  candidates.push(social?.siteUrl)
  const manifest = readJson(resolve(root, 'package.json'))
  candidates.push(
    manifest?.homepage,
    (manifest?.narduk as Record<string, unknown> | undefined)?.url,
  )
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    try {
      return new URL(candidate).host
    } catch {
      // Not a URL; try the next source.
    }
  }
  return brandShortName(brand)
}

/** Renders the default share card for the brand: the product name, its tagline, its host. */
export async function renderDefaultCard(brand: BrandConfig, root: string): Promise<Buffer> {
  const host = resolveSiteHost(root, brand)
  return renderBrandCard(brand, root, {
    title: brand.name,
    subtitle: brand.tagline ?? '',
    eyebrow: brand.og.eyebrow ?? host,
    host,
  })
}
