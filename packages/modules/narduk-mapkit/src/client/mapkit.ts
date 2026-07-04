import { isJwtExpired } from '../token/jwt.js'

export interface MapKitClientOptions {
  document?: Document
  fetchImpl?: typeof fetch
  mapkitGlobal?: unknown
  scriptUrl?: string
  staticToken?: string
  tokenEndpoint?: string
  tokenRefreshWindowMs?: number
  window?: Window
}

export interface MapKitTokenEndpointResponse {
  configured?: boolean
  error?: string
  token?: string
}

export interface MapKitRuntime {
  init(options: { authorizationCallback(done: (token: string) => void): void }): void
}

const DEFAULT_MAPKIT_SCRIPT_URL = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js'
const DEFAULT_TOKEN_ENDPOINT = '/api/mapkit-token'
const DEFAULT_TOKEN_REFRESH_WINDOW_MS = 60_000

let scriptPromise: Promise<void> | null = null
let initPromise: Promise<MapKitRuntime> | null = null
let lastIssuedToken = ''
let tokenPromise: Promise<string> | null = null

function resolveWindow(options: MapKitClientOptions): Window {
  const resolvedWindow = options.window ?? globalThis.window
  if (!resolvedWindow) {
    throw new Error('MapKit JS can only be initialized in a browser-like runtime')
  }
  return resolvedWindow
}

function resolveDocument(options: MapKitClientOptions): Document {
  const resolvedDocument = options.document ?? resolveWindow(options).document
  if (!resolvedDocument) {
    throw new Error('A DOM document is required to load MapKit JS')
  }
  return resolvedDocument
}

function resolveMapkit(options: MapKitClientOptions): MapKitRuntime {
  const candidate =
    options.mapkitGlobal ??
    (resolveWindow(options) as Window & { mapkit?: MapKitRuntime }).mapkit ??
    (globalThis as typeof globalThis & { mapkit?: MapKitRuntime }).mapkit

  if (!candidate || typeof (candidate as MapKitRuntime).init !== 'function') {
    throw new Error('MapKit JS loaded, but window.mapkit.init is not available')
  }

  return candidate as MapKitRuntime
}

export function loadMapKitScript(options: MapKitClientOptions = {}): Promise<void> {
  if (options.mapkitGlobal) return Promise.resolve()

  const document = resolveDocument(options)
  const scriptUrl = options.scriptUrl ?? DEFAULT_MAPKIT_SCRIPT_URL

  scriptPromise ??= new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${scriptUrl}"]`)) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = scriptUrl
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load MapKit JS from ${scriptUrl}`))
    document.head.appendChild(script)
  })

  return scriptPromise
}

export async function fetchMapKitToken(
  endpoint = DEFAULT_TOKEN_ENDPOINT,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(endpoint, {
    headers: { accept: 'application/json' },
  })
  const data = (await response.json()) as MapKitTokenEndpointResponse
  if (response.ok && data.token) return data.token
  throw new Error(data.error || `MapKit token request failed with ${response.status}`)
}

export async function initializeMapKit(options: MapKitClientOptions = {}): Promise<MapKitRuntime> {
  initPromise ??= (async () => {
    await loadMapKitScript(options)
    const mapkit = resolveMapkit(options)
    const refreshWindowMs = options.tokenRefreshWindowMs ?? DEFAULT_TOKEN_REFRESH_WINDOW_MS

    async function resolveToken(): Promise<string> {
      if (options.staticToken && !isJwtExpired(options.staticToken, Date.now(), refreshWindowMs)) {
        return options.staticToken
      }
      if (lastIssuedToken && !isJwtExpired(lastIssuedToken, Date.now(), refreshWindowMs)) {
        return lastIssuedToken
      }
      tokenPromise ??= fetchMapKitToken(options.tokenEndpoint, options.fetchImpl).finally(() => {
        tokenPromise = null
      })
      lastIssuedToken = await tokenPromise
      return lastIssuedToken
    }

    const firstToken = await resolveToken()
    lastIssuedToken = firstToken

    mapkit.init({
      authorizationCallback: (done) => {
        void (async () => {
          try {
            done(await resolveToken())
          } catch {
            done('')
          }
        })()
      },
    })

    return mapkit
  })()

  return initPromise
}

export function resetMapKitClientStateForTests(): void {
  scriptPromise = null
  initPromise = null
  lastIssuedToken = ''
  tokenPromise = null
}
