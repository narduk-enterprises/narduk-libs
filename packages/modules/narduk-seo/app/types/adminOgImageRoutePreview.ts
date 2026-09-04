export interface AdminOgImageRoutePreviewEntry {
  adminPath?: string
  alt: string
  imageSrc: string
  label: string
  meta: string
  routePath: string
  template?: string
}

export interface AdminOgImageRoutePreviewGroup {
  entries: AdminOgImageRoutePreviewEntry[]
  note?: string
  title: string
}

export interface AdminOgImageRoutePreviewTarget {
  adminPath?: string
  alt: string
  label: string
  meta: string
  routePath: string
  template?: string
}
