import type {
  AdminOgImageRoutePreviewEntry,
  AdminOgImageRoutePreviewGroup,
} from '../types/adminOgImageRoutePreview'

/** @deprecated Prefer `AdminOgImageRoutePreviewEntry` from the same layer types. */
export type AdminOgImagePreviewEntry = AdminOgImageRoutePreviewEntry
/** @deprecated Prefer `AdminOgImageRoutePreviewGroup` from the same layer types. */
export type AdminOgImagePreviewGroup = AdminOgImageRoutePreviewGroup

export interface AdminOgImagePreviewsResponse {
  groups: AdminOgImageRoutePreviewGroup[]
}

export async function useAdminOgImagePreviews() {
  const { data, pending, refresh } = await useFetch<AdminOgImagePreviewsResponse>(
    '/api/admin/og-image-previews',
    {
      key: 'admin-og-image-previews',
    },
  )

  return { data, pending, refresh }
}
