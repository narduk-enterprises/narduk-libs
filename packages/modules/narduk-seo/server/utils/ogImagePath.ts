import { digest } from 'ohash/crypto'
import { joinURL } from 'ufo'

const RE_BASE64_PADDING = /=/g
const RE_BASE64_PLUS = /\+/g
const RE_BASE64_SLASH = /\//g
const RE_NON_ASCII = /[^\u0020-\u007E]/
const RE_PERCENT20 = /%20/g
const RE_UNDERSCORE = /_/g
// nuxt-og-image 6.8.0 base64-encodes values with Windows-reserved filename
// characters. encodeURIComponent already escapes all of them except `*`.
const RE_WINDOWS_RESERVED_FILENAME_CHARACTERS = /[<>:"/\\|?*]/

const PARAM_TO_ALIAS = {
  width: 'w',
  height: 'h',
  component: 'c',
  key: 'k',
  alt: 'a',
  cacheMaxAgeSeconds: 'cache',
  _path: 'p',
} as const

interface OgPreviewOptions {
  _path: string
  alt?: string
  cacheMaxAgeSeconds?: number
  component?: string
  extension?: string
  height?: number
  key?: string
  props?: Record<string, string | number | boolean | undefined>
  width?: number
}

function b64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll(RE_BASE64_PADDING, '')
    .replaceAll(RE_BASE64_PLUS, '-')
    .replaceAll(RE_BASE64_SLASH, '~')
}

function encodeSimpleValue(value: string): string {
  if (RE_NON_ASCII.test(value)) {
    return `~${b64Encode(value)}`
  }

  const escaped = value.startsWith('~') ? `~${value}` : value
  const encoded = encodeURIComponent(escaped.replaceAll(RE_UNDERSCORE, '__')).replaceAll(
    RE_PERCENT20,
    '+',
  )

  if (encoded.includes('%') || RE_WINDOWS_RESERVED_FILENAME_CHARACTERS.test(value)) {
    return `~${b64Encode(value)}`
  }

  return encoded
}

function encodeOgImagePreviewParams(
  options: OgPreviewOptions,
  defaults: Partial<OgPreviewOptions> = {},
): string {
  const parts: string[] = []
  const entries = {
    ...Object.fromEntries(
      Object.entries(options.props ?? {}).filter(([, prop]) => prop !== undefined),
    ),
    width: options.width,
    height: options.height,
    component: options.component,
    alt: options.alt,
    cacheMaxAgeSeconds: options.cacheMaxAgeSeconds,
    key: options.key,
    _path: options._path,
  }

  for (const [key, rawValue] of Object.entries(entries)) {
    if (rawValue === undefined || rawValue === '') {
      continue
    }

    if (
      key in defaults &&
      defaults[key as keyof OgPreviewOptions] === rawValue &&
      key !== 'component'
    ) {
      continue
    }

    const alias = key in PARAM_TO_ALIAS ? PARAM_TO_ALIAS[key as keyof typeof PARAM_TO_ALIAS] : key

    if (key === '_path') {
      parts.push(`${alias}_${b64Encode(JSON.stringify(rawValue))}`)
      continue
    }

    parts.push(`${alias}_${encodeSimpleValue(String(rawValue))}`)
  }

  return parts.join(',')
}

export function buildSeoOgImagePreviewPath(
  options: OgPreviewOptions,
  config: {
    baseURL: string
    defaults?: Partial<OgPreviewOptions>
    secret?: string
  },
): string {
  const extension = options.extension ?? config.defaults?.extension ?? 'png'
  const encoded = encodeOgImagePreviewParams(options, config.defaults)
  const segment = encoded || 'default'
  const signed = config.secret
    ? `${segment},s_${digest(`${config.secret}:${segment}`).slice(0, 16)}`
    : segment

  return joinURL('/', config.baseURL, `/_og/d/${signed}.${extension}`)
}
