type OgImagePreviewResolverAccess =
  | {
      allowed: true
      requireAdmin: boolean
    }
  | {
      allowed: false
      statusCode: 404 | 503
      statusMessage: string
    }

export function getOgImagePreviewResolverAccess(options: {
  hasSigningSecret: boolean
  isDev: boolean
  previewLabEnabled: boolean
}): OgImagePreviewResolverAccess {
  if (options.isDev) {
    return {
      allowed: true,
      requireAdmin: false,
    }
  }

  if (!options.previewLabEnabled) {
    return {
      allowed: false,
      statusCode: 404,
      statusMessage: 'Not Found',
    }
  }

  if (!options.hasSigningSecret) {
    return {
      allowed: false,
      statusCode: 503,
      statusMessage: 'OG image preview requires nuxt-og-image security.secret outside local dev.',
    }
  }

  return {
    allowed: true,
    requireAdmin: true,
  }
}
