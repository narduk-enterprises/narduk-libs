import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import { getRequestHeader } from 'h3'

import { sanitizeSameOriginPath } from '../../app/utils/same-origin-path'

import { pickOgImageContentFromHtml } from './pickOgImageContentFromHtml'

import type {
  AdminOgImageRoutePreviewEntry,
  AdminOgImageRoutePreviewTarget,
} from '../../app/types/adminOgImageRoutePreview'
import type { H3Event } from 'h3'

export type {
  AdminOgImageRoutePreviewEntry,
  AdminOgImageRoutePreviewGroup,
  AdminOgImageRoutePreviewTarget,
} from '../../app/types/adminOgImageRoutePreview'

// The preview SSR-renders one of the app's own routes; a render that stalls
// must not hold the admin request open. A timeout rejects the fetch and lands
// in the catch below, which logs it and falls back to the static image.
const OG_PREVIEW_FETCH_TIMEOUT_MS = 10_000

export async function resolveAdminOgImageRoutePreviewEntry(
  event: H3Event,
  origin: string,
  target: AdminOgImageRoutePreviewTarget,
  fallback: string,
): Promise<AdminOgImageRoutePreviewEntry> {
  try {
    // The admin cookie is forwarded, so the target must stay on this origin.
    const routePath = sanitizeSameOriginPath(target.routePath, '')
    if (!routePath) throw new Error(`OG preview route is not same-origin: ${target.routePath}`)
    const cookie = getRequestHeader(event, 'cookie')
    const res = await fetch(`${origin}${routePath}`, {
      headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) },
      signal: AbortSignal.timeout(OG_PREVIEW_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`OG preview fetch ${target.routePath}: ${res.status}`)
    }
    const html = await res.text()
    const absolute = pickOgImageContentFromHtml(html)
    if (absolute) {
      let src = absolute
      try {
        const url = new URL(absolute)
        if (url.origin === origin) src = url.pathname + url.search
      } catch {
        // Leave as-is if parsing fails (relative or malformed URL).
      }
      return { ...target, imageSrc: src }
    }
  } catch (error) {
    useLogger(event)
      .child('OgImagePreviews')
      .warn('Failed to resolve OG image preview', {
        routePath: target.routePath,
        error: error instanceof Error ? error.message : String(error),
      })
  }
  return { ...target, imageSrc: fallback }
}
