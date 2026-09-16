import { z } from 'zod'

import { requireAdmin } from '#layer/server/utils/auth'
import { buildSeoOgImagePreviewPath } from '#narduk-seo-server/utils/ogImagePath'
import { getOgImagePreviewResolverAccess } from '#narduk-seo-server/utils/ogImagePreviewAccess'

import {
  isSeoOgImageHexColor,
  normalizeSeoOgImageHexColor,
  resolveSeoOgImageDefinition,
  SEO_OG_IMAGE_DEFAULT_PRIMARY,
  SEO_OG_IMAGE_DEFAULT_SECONDARY,
} from '../../../app/utils/ogImageDefinition'

const PREVIEW_MAX_LENGTH = {
  key: 120,
  title: 160,
  description: 320,
  siteName: 80,
  shortText: 80,
  image: 512,
} as const

function isSafePreviewImagePath(value: string): boolean {
  return value === '' || /^\/(?!\/)/.test(value)
}

const querySchema = z.object({
  key: z.string().trim().min(1).max(PREVIEW_MAX_LENGTH.key),
  variant: z.enum(['Default', 'Article']),
  title: z.string().trim().min(1).max(PREVIEW_MAX_LENGTH.title),
  description: z.string().trim().min(1).max(PREVIEW_MAX_LENGTH.description),
  siteName: z.string().trim().min(1).max(PREVIEW_MAX_LENGTH.siteName),
  eyebrow: z.string().trim().max(PREVIEW_MAX_LENGTH.shortText).optional(),
  category: z.string().trim().max(PREVIEW_MAX_LENGTH.shortText).optional(),
  badgeLabel: z.string().trim().max(PREVIEW_MAX_LENGTH.shortText).optional(),
  image: z
    .string()
    .trim()
    .max(PREVIEW_MAX_LENGTH.image)
    .refine(isSafePreviewImagePath, {
      message: 'Preview images must use same-origin absolute paths.',
    })
    .optional(),
  primaryColor: z
    .string()
    .trim()
    .refine(isSeoOgImageHexColor, {
      message: 'Preview colors must use 3-digit or 6-digit hex values.',
    })
    .transform((value) => normalizeSeoOgImageHexColor(value, SEO_OG_IMAGE_DEFAULT_PRIMARY))
    .optional(),
  secondaryColor: z
    .string()
    .trim()
    .refine(isSeoOgImageHexColor, {
      message: 'Preview colors must use 3-digit or 6-digit hex values.',
    })
    .transform((value) => normalizeSeoOgImageHexColor(value, SEO_OG_IMAGE_DEFAULT_SECONDARY))
    .optional(),
})

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const appConfig = runtimeConfig.app
  const appBaseURL =
    typeof appConfig === 'object' &&
    appConfig !== null &&
    'baseURL' in appConfig &&
    typeof appConfig.baseURL === 'string'
      ? appConfig.baseURL
      : '/'
  const ogImageConfig = runtimeConfig['nuxt-og-image'] as
    | {
        defaults?: {
          cacheMaxAgeSeconds?: number
          extension?: string
          height?: number
          width?: number
        }
        security?: {
          secret?: string
        }
      }
    | undefined
  const access = getOgImagePreviewResolverAccess({
    isDev: import.meta.dev,
    previewLabEnabled: Boolean(runtimeConfig.public.ogImagePreviewLab),
    hasSigningSecret: Boolean(ogImageConfig?.security?.secret),
  })

  if (!access.allowed) {
    throw createError({
      statusCode: access.statusCode,
      statusMessage: access.statusMessage,
    })
  }

  if (access.requireAdmin) {
    await requireAdmin(event)
  }

  const query = await getValidatedQuery(event, querySchema.parse)

  const definition = resolveSeoOgImageDefinition({
    title: query.title,
    description: query.description,
    type: query.variant === 'Article' ? 'article' : 'website',
    siteName: query.siteName,
    image: query.image,
    ogImage: {
      component: query.variant,
      ...(query.eyebrow ? { eyebrow: query.eyebrow } : {}),
      ...(query.variant === 'Article' && query.category ? { category: query.category } : {}),
      ...(query.badgeLabel ? { badgeLabel: query.badgeLabel } : {}),
      ...(query.image ? { image: query.image } : {}),
      ...(query.primaryColor ? { primaryColor: query.primaryColor } : {}),
      ...(query.secondaryColor ? { secondaryColor: query.secondaryColor } : {}),
    },
  })

  if (!definition) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unable to resolve OG image preview options.',
    })
  }

  setResponseHeader(event, 'cache-control', 'no-store')

  return {
    path: buildSeoOgImagePreviewPath(
      {
        component: definition.component,
        props: definition.props,
        ...definition.options,
        key: query.key,
        _path: '/__preview/og-images',
      },
      {
        baseURL: appBaseURL,
        defaults: ogImageConfig?.defaults,
        secret: ogImageConfig?.security?.secret,
      },
    ),
  }
})
