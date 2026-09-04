import { createAppleMapsAuthToken, isJwtExpired } from '../token/jwt.js'

export interface AppleMapsServerConfig {
  /** Apple Maps identifier used as the JWT `appid` claim. */
  appId?: string
  /** A pre-signed Maps auth JWT accepted by `/v1/token`. */
  authToken?: string
  cache?: false | AppleMapsAccessTokenCacheConfig
  fetch?: typeof fetch
  keyId?: string
  privateKey?: CryptoKey | string
  teamId?: string
}

export interface AppleMapsAccessTokenCacheConfig {
  refreshWindowMs?: number
}

export interface AppleMapsAccessTokenResponse {
  accessToken: string
  expiresInSeconds?: number
}

export interface AppleMapsCoordinate {
  latitude?: number | string
  longitude?: number | string
}

export interface AppleMapsSearchResult {
  coordinate?: AppleMapsCoordinate
  country?: string
  countryCode?: string
  displayName?: string
  formattedAddressLines?: string[]
  name?: string
  poiCategory?: string
  structuredAddress?: Record<string, unknown>
  [key: string]: unknown
}

export interface AppleMapsSearchResponse {
  displayMapRegion?: Record<string, unknown>
  results?: AppleMapsSearchResult[]
}

export interface AppleMapsGeocodeResponse {
  results?: AppleMapsSearchResult[]
}

export interface AppleMapsSearchOptions {
  accessToken?: string
  categories?: readonly string[]
  fetch?: typeof fetch
  includeAddressCategories?: string
  includePoiCategories?: string
  language?: string
  lat?: number
  limit?: number
  limitToCountries?: string
  lng?: number
  resultTypeFilter?: 'Address' | 'Poi'
  searchLocation?: { lat: number; lng: number }
  searchRegion?: string | { east: number; north: number; south: number; west: number }
  serverConfig?: AppleMapsServerConfig
}

export interface AppleMapsGeocodeOptions {
  accessToken?: string
  fetch?: typeof fetch
  language?: string
  limitToCountries?: string
  searchRegion?: string
  serverConfig?: AppleMapsServerConfig
}

export interface AppleMapsCreds {
  appleKeyId: string
  appleMapsAppId?: string
  appleSecretKey: string
  appleTeamId: string
  mapkitServerApiKey: string
}

export interface AppleMapsExchangedAccessToken {
  accessToken: string
  expiresAtMs: number
}

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 1800
const DEFAULT_ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000
const accessTokenCache = new Map<string, AppleMapsExchangedAccessToken>()
const cryptoKeyIdentities = new WeakMap<object, string>()
let nextCryptoKeyIdentity = 1

function requireTrimmed(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${name} is required`)
  return trimmed
}

function resolveFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  return fetchImpl ?? fetch
}

function requirePrivateKey(value: CryptoKey | string | undefined): CryptoKey | string {
  if (typeof value === 'string') return requireTrimmed(value, 'privateKey')
  if (value) return value
  throw new Error('privateKey is required')
}

async function responseError(response: Response, operation: string): Promise<Error> {
  const body = await response.text()
  return new Error(`${operation} failed (${response.status}): ${body}`)
}

async function cacheKeyForConfig(config: AppleMapsServerConfig): Promise<string> {
  let privateKeyIdentity = ''
  if (typeof config.privateKey === 'string') {
    privateKeyIdentity = config.privateKey.trim().replaceAll('\\n', '\n')
  } else if (config.privateKey) {
    privateKeyIdentity = cryptoKeyIdentities.get(config.privateKey) ?? ''
    if (!privateKeyIdentity) {
      privateKeyIdentity = `crypto-key-${nextCryptoKeyIdentity++}`
      cryptoKeyIdentities.set(config.privateKey, privateKeyIdentity)
    }
  }
  const identity = [
    config.teamId?.trim() ?? '',
    config.keyId?.trim() ?? '',
    config.appId?.trim() ?? '',
    privateKeyIdentity,
    config.authToken?.trim() ?? '',
  ].join('\0')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cacheRefreshWindowMs(config: AppleMapsServerConfig): number {
  const configured = typeof config.cache === 'object' ? config.cache.refreshWindowMs : undefined
  return typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_ACCESS_TOKEN_REFRESH_WINDOW_MS
}

/** Create the short-lived Maps auth JWT exchanged at Apple's `/v1/token`. */
export async function createAppleMapsDeveloperToken(
  config: AppleMapsServerConfig,
): Promise<string> {
  const configuredToken = config.authToken?.trim() ?? ''
  if (configuredToken && !isJwtExpired(configuredToken, Date.now(), 60_000)) {
    return configuredToken
  }

  return createAppleMapsAuthToken({
    appId: requireTrimmed(config.appId, 'appId'),
    keyId: requireTrimmed(config.keyId, 'keyId'),
    privateKey: requirePrivateKey(config.privateKey),
    teamId: requireTrimmed(config.teamId, 'teamId'),
  })
}

/** Compatibility alias for the former maps-layer credential shape. */
export function getDeveloperToken(config: AppleMapsCreds): Promise<string> {
  const serverConfig: AppleMapsServerConfig = {
    keyId: config.appleKeyId,
    privateKey: config.appleSecretKey,
    teamId: config.appleTeamId,
  }
  if (config.appleMapsAppId) serverConfig.appId = config.appleMapsAppId
  if (config.mapkitServerApiKey) serverConfig.authToken = config.mapkitServerApiKey
  return createAppleMapsDeveloperToken(serverConfig)
}

/** Exchange an Apple Maps auth JWT for a Maps Server API access token. */
export async function exchangeAppleMapsAccessToken(
  authToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AppleMapsExchangedAccessToken> {
  const response = await fetchImpl('https://maps-api.apple.com/v1/token', {
    headers: { Authorization: `Bearer ${requireTrimmed(authToken, 'authToken')}` },
  })
  if (!response.ok) throw await responseError(response, 'Apple Maps token exchange')

  const body = (await response.json()) as AppleMapsAccessTokenResponse
  const accessToken = requireTrimmed(body.accessToken, 'Apple Maps accessToken')
  const expiresInSeconds = body.expiresInSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error('Apple Maps token exchange returned an invalid expiresInSeconds value')
  }

  return { accessToken, expiresAtMs: Date.now() + expiresInSeconds * 1000 }
}

/** Resolve and cache an Apple Maps Server API access token. */
export async function getAppleMapsAccessToken(config: AppleMapsServerConfig): Promise<string> {
  const cacheKey = config.cache === false ? null : await cacheKeyForConfig(config)
  if (cacheKey) {
    const cached = accessTokenCache.get(cacheKey)
    if (cached && cached.expiresAtMs > Date.now() + cacheRefreshWindowMs(config)) {
      return cached.accessToken
    }
    accessTokenCache.delete(cacheKey)
  }

  const authToken = await createAppleMapsDeveloperToken(config)
  const exchanged = await exchangeAppleMapsAccessToken(authToken, resolveFetch(config.fetch))
  if (cacheKey) accessTokenCache.set(cacheKey, exchanged)
  return exchanged.accessToken
}

async function resolveAccessToken(
  accessToken: string | undefined,
  serverConfig: AppleMapsServerConfig | undefined,
): Promise<string> {
  if (accessToken?.trim()) return accessToken.trim()
  if (!serverConfig) {
    throw new Error('Apple Maps accessToken or serverConfig is required')
  }
  return getAppleMapsAccessToken(serverConfig)
}

function setSearchRegion(
  params: URLSearchParams,
  region: AppleMapsSearchOptions['searchRegion'],
): void {
  if (!region) return
  if (typeof region === 'string') {
    params.set('searchRegion', region)
    return
  }
  params.set('searchRegion', `${region.north},${region.east},${region.south},${region.west}`)
}

async function fetchAppleMapsJson<T>(
  path: string,
  params: URLSearchParams,
  accessToken: string,
  fetchImpl: typeof fetch,
  operation: string,
): Promise<T> {
  const url = new URL(path, 'https://maps-api.apple.com')
  url.search = params.toString()
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw await responseError(response, operation)
  return response.json() as Promise<T>
}

/** Search the Apple Maps Server API for places or addresses. */
export async function searchAppleMaps(
  query: string,
  options: AppleMapsSearchOptions = {},
): Promise<AppleMapsSearchResponse> {
  const params = new URLSearchParams({
    q: requireTrimmed(query, 'query'),
    resultTypeFilter: options.resultTypeFilter ?? 'Poi',
  })
  if (options.categories?.length) params.set('includePoiCategories', options.categories.join(','))
  if (options.includePoiCategories) {
    params.set('includePoiCategories', options.includePoiCategories)
  }
  if (options.includeAddressCategories) {
    params.set('includeAddressCategories', options.includeAddressCategories)
  }
  const location = options.searchLocation ??
    (options.lat != null && options.lng != null ? { lat: options.lat, lng: options.lng } : undefined)
  if (location) params.set('searchLocation', `${location.lat},${location.lng}`)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.limitToCountries) params.set('limitToCountries', options.limitToCountries)
  if (options.language) params.set('lang', options.language)
  setSearchRegion(params, options.searchRegion)

  const accessToken = await resolveAccessToken(options.accessToken, options.serverConfig)
  return fetchAppleMapsJson(
    '/v1/search',
    params,
    accessToken,
    resolveFetch(options.fetch ?? options.serverConfig?.fetch),
    'Apple Maps search',
  )
}

/** Geocode an address through the Apple Maps Server API. */
export async function geocodeAppleMaps(
  address: string,
  options: AppleMapsGeocodeOptions = {},
): Promise<AppleMapsGeocodeResponse> {
  const params = new URLSearchParams({ q: requireTrimmed(address, 'address') })
  if (options.searchRegion) params.set('searchRegion', options.searchRegion)
  if (options.limitToCountries) params.set('limitToCountries', options.limitToCountries)
  if (options.language) params.set('lang', options.language)

  const accessToken = await resolveAccessToken(options.accessToken, options.serverConfig)
  return fetchAppleMapsJson(
    '/v1/geocode',
    params,
    accessToken,
    resolveFetch(options.fetch ?? options.serverConfig?.fetch),
    'Apple Maps geocode',
  )
}

/** Compatibility helper matching the former layer's place-search result shape. */
export async function searchPlaces(
  accessToken: string,
  options: Omit<AppleMapsSearchOptions, 'accessToken' | 'resultTypeFilter'> & { query: string },
): Promise<AppleMapsSearchResult[]> {
  const response = await searchAppleMaps(options.query, {
    ...options,
    accessToken,
    language: options.language ?? 'en-US',
    limitToCountries: options.limitToCountries ?? 'US',
    resultTypeFilter: 'Poi',
  })
  return response.results ?? []
}

/** Search for a neighborhood/sub-locality address result. */
export function searchAppleMapsNeighborhood(
  name: string,
  options: Omit<AppleMapsSearchOptions, 'resultTypeFilter'> & { locationContext?: string } = {},
): Promise<AppleMapsSearchResponse> {
  const query = options.locationContext ? `${name}, ${options.locationContext}` : name
  return searchAppleMaps(query, {
    ...options,
    includeAddressCategories: options.includeAddressCategories ?? 'SubLocality',
    limitToCountries: options.limitToCountries ?? 'US',
    resultTypeFilter: 'Address',
  })
}

export function clearAppleMapsAccessTokenCacheForTests(): void {
  accessTokenCache.clear()
}
