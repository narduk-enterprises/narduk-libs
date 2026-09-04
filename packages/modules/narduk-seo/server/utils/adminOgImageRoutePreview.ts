import { getRequestHeaders } from 'h3'

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

export async function resolveAdminOgImageRoutePreviewEntry(
  event: H3Event,
  origin: string,
  target: AdminOgImageRoutePreviewTarget,
  fallback: string,
): Promise<AdminOgImageRoutePreviewEntry> {
  try {
    const res = await fetch(`${origin}${target.routePath}`, {
      headers: {
        ...getRequestHeaders(event),
        accept: 'text/html',
      },
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
    console.warn('[admin/og-image-previews] failed to resolve', target.routePath, error)
  }
  return { ...target, imageSrc: fallback }
}
