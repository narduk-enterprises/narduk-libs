import type { OgPreviewData } from '../utils/ogPreview'

/**
 * Hook to fetch OpenGraph image dashboard data.
 * Host apps may return either a flat `OgPreviewCategory[]` or an object with
 * `{ sections: OgPreviewCategory[] }`.
 */
export function useOgImageData() {
  return useAsyncData('layer-og-image-data', () =>
    $fetch<OgPreviewData>('/api/admin/og-image-data'),
  )
}
