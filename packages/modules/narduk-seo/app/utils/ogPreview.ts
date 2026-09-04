export interface OgPreviewItem {
  label: string
  ogUrl: string
  path: string
}

export interface OgPreviewCategory {
  category?: string
  items: OgPreviewItem[]
  title?: string
}

export interface OgPreviewPayload {
  sections: OgPreviewCategory[]
}

export type OgPreviewData = OgPreviewCategory[] | OgPreviewPayload

export function normalizeOgPreviewSections(
  data: OgPreviewData | null | undefined,
): OgPreviewCategory[] {
  if (data == null) return []
  if (Array.isArray(data)) return data
  return data.sections
}
