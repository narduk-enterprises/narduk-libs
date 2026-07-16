import { isJwtExpired } from '../token/jwt.js';
export const MAPKIT_JS_V6_SCRIPT_URL = 'https://cdn.apple-mapkit.com/mk/6/mapkit.core.js';
const DEFAULT_MAPKIT_SCRIPT_URL = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
const DEFAULT_TOKEN_ENDPOINT = '/api/mapkit-token';
const DEFAULT_TOKEN_REFRESH_WINDOW_MS = 60_000;
let scriptPromise = null;
let scriptPromiseKey = '';
let initPromise = null;
let initPromiseKey = '';
let lastIssuedToken = '';
let tokenPromise = null;
let objectIdCounter = 0;
const objectIds = new WeakMap();
function optionIdentity(value) {
    if (value === undefined || value === null)
        return '';
    if (typeof value !== 'object' && typeof value !== 'function')
        return String(value);
    const objectValue = value;
    let id = objectIds.get(objectValue);
    if (!id) {
        id = ++objectIdCounter;
        objectIds.set(objectValue, id);
    }
    return `#${id}`;
}
function mapKitScriptCacheKey(options) {
    if (options.mapkitGlobal)
        return `mapkitGlobal:${optionIdentity(options.mapkitGlobal)}`;
    return [
        options.scriptUrl ?? DEFAULT_MAPKIT_SCRIPT_URL,
        optionIdentity(options.document),
        optionIdentity(options.window),
    ].join('|');
}
function mapKitInitCacheKey(options) {
    return [
        mapKitScriptCacheKey(options),
        options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        options.tokenRefreshWindowMs ?? DEFAULT_TOKEN_REFRESH_WINDOW_MS,
        optionIdentity(options.staticToken),
        optionIdentity(options.fetchImpl),
        optionIdentity(options.mapkitGlobal),
        optionIdentity(options.document),
        optionIdentity(options.window),
    ].join('|');
}
function resolveWindow(options) {
    const resolvedWindow = options.window ?? globalThis.window;
    if (!resolvedWindow) {
        throw new Error('MapKit JS can only be initialized in a browser-like runtime');
    }
    return resolvedWindow;
}
function resolveDocument(options) {
    const resolvedDocument = options.document ?? resolveWindow(options).document;
    if (!resolvedDocument) {
        throw new Error('A DOM document is required to load MapKit JS');
    }
    return resolvedDocument;
}
function resolveMapkit(options) {
    const candidate = options.mapkitGlobal ??
        resolveWindow(options).mapkit ??
        globalThis.mapkit;
    if (!candidate || typeof candidate.init !== 'function') {
        throw new Error('MapKit JS loaded, but window.mapkit.init is not available');
    }
    return candidate;
}
export function loadMapKitScript(options = {}) {
    if (options.mapkitGlobal)
        return Promise.resolve();
    const document = resolveDocument(options);
    const scriptUrl = options.scriptUrl ?? DEFAULT_MAPKIT_SCRIPT_URL;
    const cacheKey = mapKitScriptCacheKey(options);
    if (scriptPromise && scriptPromiseKey !== cacheKey) {
        return Promise.reject(new Error('MapKit script loading is already in progress with different options'));
    }
    if (scriptPromise)
        return scriptPromise;
    scriptPromiseKey = cacheKey;
    const nextScriptPromise = new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${scriptUrl}"]`)) {
            resolve(undefined);
            return;
        }
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve(undefined);
        script.onerror = () => reject(new Error(`Failed to load MapKit JS from ${scriptUrl}`));
        document.head.appendChild(script);
    }).catch((error) => {
        scriptPromise = null;
        scriptPromiseKey = '';
        throw error;
    });
    scriptPromise ??= nextScriptPromise;
    return scriptPromise;
}
export async function fetchMapKitToken(endpoint = DEFAULT_TOKEN_ENDPOINT, fetchImpl = fetch) {
    const response = await fetchImpl(endpoint, {
        headers: { accept: 'application/json' },
    });
    const data = (await response.json());
    if (response.ok && data.token)
        return data.token;
    throw new Error(data.error || `MapKit token request failed with ${response.status}`);
}
export async function initializeMapKit(options = {}) {
    const cacheKey = mapKitInitCacheKey(options);
    if (initPromise && initPromiseKey !== cacheKey) {
        throw new Error('MapKit is already initialized or initializing with different options');
    }
    initPromiseKey = cacheKey;
    initPromise ??= (async () => {
        await loadMapKitScript(options);
        const mapkit = resolveMapkit(options);
        const refreshWindowMs = options.tokenRefreshWindowMs ?? DEFAULT_TOKEN_REFRESH_WINDOW_MS;
        async function resolveToken() {
            if (options.staticToken && !isJwtExpired(options.staticToken, Date.now(), refreshWindowMs)) {
                return options.staticToken;
            }
            if (lastIssuedToken && !isJwtExpired(lastIssuedToken, Date.now(), refreshWindowMs)) {
                return lastIssuedToken;
            }
            tokenPromise ??= fetchMapKitToken(options.tokenEndpoint, options.fetchImpl).finally(() => {
                tokenPromise = null;
            });
            lastIssuedToken = await tokenPromise;
            return lastIssuedToken;
        }
        const firstToken = await resolveToken();
        lastIssuedToken = firstToken;
        mapkit.init({
            authorizationCallback: (done) => {
                void (async () => {
                    try {
                        done(await resolveToken());
                    }
                    catch {
                        done('');
                    }
                })();
            },
        });
        return mapkit;
    })().catch((error) => {
        initPromise = null;
        initPromiseKey = '';
        lastIssuedToken = '';
        tokenPromise = null;
        throw error;
    });
    return initPromise;
}
/** Load optional MapKit JS 6 libraries after initializeMapKit() completes. */
export async function loadMapKitLibraries(mapkit, libraries = ['map', 'overlays']) {
    if (typeof mapkit.load !== 'function') {
        throw new Error('MapKit JS library loading requires the MapKit JS 6 core bundle');
    }
    await mapkit.load(libraries);
}
export function resetMapKitClientStateForTests() {
    scriptPromise = null;
    scriptPromiseKey = '';
    initPromise = null;
    initPromiseKey = '';
    lastIssuedToken = '';
    tokenPromise = null;
}
//# sourceMappingURL=mapkit.js.map