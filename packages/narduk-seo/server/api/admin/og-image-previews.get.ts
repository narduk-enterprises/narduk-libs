import { requireAdmin } from '#layer/server/utils/auth'
import { resolveAdminOgImageRoutePreviewEntry } from '#narduk-seo-server/utils/adminOgImageRoutePreview'

import type { AdminOgImageRoutePreviewGroup } from '../../../app/types/adminOgImageRoutePreview'

/**
 * Lists Open Graph images by SSR-fetching public routes and parsing `og:image` metas.
 * Downstream apps should override this handler to register product/blog routes and groups.
 */
export default defineEventHandler(
  async (event): Promise<{ groups: AdminOgImageRoutePreviewGroup[] }> => {
    await requireAdmin(event)

    const origin = getRequestURL(event).origin

    const staticGroup: AdminOgImageRoutePreviewGroup = {
      title: 'Static default',
      entries: [
        {
          label: 'Site default',
          routePath: '/',
          imageSrc: '/og.png',
          meta: 'Fallback when a route has no dynamic OG image',
          alt: 'Default social share image',
        },
      ],
    }

    const homeTarget = {
      label: 'Home page',
      routePath: '/',
      meta: 'Resolved from live HTML (dynamic OG wins over static when present)',
      alt: 'Homepage share preview',
    }

    const homeEntry = await resolveAdminOgImageRoutePreviewEntry(
      event,
      origin,
      homeTarget,
      '/og.png',
    )

    const routesGroup: AdminOgImageRoutePreviewGroup = {
      title: 'Routes',
      note: 'Override server/api/admin/og-image-previews.get.ts in your app to add PDPs and templates.',
      entries: [homeEntry],
    }

    return { groups: [staticGroup, routesGroup] }
  },
)
