import { base64urlEncode, derEcdsaSignatureToRaw, importPrivateKeyForAppleMaps, } from './crypto.js';
const DEFAULT_MAPKIT_TOKEN_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_APPLE_MAPS_AUTH_TTL_SECONDS = 60 * 30;
function normalizePem(privateKey) {
    return privateKey.includes('\\n') ? privateKey.replaceAll('\\n', '\n') : privateKey;
}
async function resolvePrivateKey(privateKey) {
    if (typeof privateKey !== 'string')
        return privateKey;
    return importPrivateKeyForAppleMaps(normalizePem(privateKey));
}
function encodeJwtPart(value) {
    return base64urlEncode(JSON.stringify(value));
}
async function signJwt(privateKeyInput, header, payload) {
    const privateKey = await resolvePrivateKey(privateKeyInput);
    const signingInput = `${encodeJwtPart(header)}.${encodeJwtPart(payload)}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signingInput));
    const rawSignature = derEcdsaSignatureToRaw(new Uint8Array(signature));
    return `${signingInput}.${base64urlEncode(rawSignature.buffer)}`;
}
function requireTrimmed(value, name) {
    const trimmed = value.trim();
    if (!trimmed)
        throw new Error(`${name} is required`);
    return trimmed;
}
export async function createMapKitToken(options) {
    const teamId = requireTrimmed(options.teamId, 'teamId');
    const keyId = requireTrimmed(options.keyId, 'keyId');
    const origin = requireTrimmed(options.origin, 'origin');
    const issuedAt = options.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
    const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_MAPKIT_TOKEN_TTL_SECONDS;
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new RangeError('expiresInSeconds must be a finite positive number');
    }
    return signJwt(options.privateKey, { alg: 'ES256', kid: keyId, typ: 'JWT' }, {
        iss: teamId,
        iat: issuedAt,
        exp: issuedAt + expiresInSeconds,
        origin,
    });
}
export async function createAppleMapsAuthToken(options) {
    const teamId = requireTrimmed(options.teamId, 'teamId');
    const keyId = requireTrimmed(options.keyId, 'keyId');
    const appId = requireTrimmed(options.appId, 'appId');
    const issuedAt = options.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
    const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_APPLE_MAPS_AUTH_TTL_SECONDS;
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new RangeError('expiresInSeconds must be a finite positive number');
    }
    return signJwt(options.privateKey, { alg: 'ES256', kid: keyId, typ: 'JWT' }, {
        iss: teamId,
        iat: issuedAt,
        exp: issuedAt + expiresInSeconds,
        appid: appId,
    });
}
export function decodeJwt(token) {
    const [encodedHeader, encodedPayload] = token.split('.');
    if (!encodedHeader || !encodedPayload) {
        throw new Error('JWT must contain header and payload segments');
    }
    return {
        header: decodeBase64UrlJson(encodedHeader),
        payload: decodeBase64UrlJson(encodedPayload),
    };
}
export function decodeBase64UrlJson(segment) {
    const padded = segment.replaceAll('-', '+').replaceAll('_', '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return JSON.parse(atob(padded + padding));
}
export function isJwtExpired(token, nowMs = Date.now(), refreshWindowMs = 0) {
    try {
        const { payload } = decodeJwt(token);
        const exp = payload.exp;
        if (typeof exp !== 'number' || !Number.isFinite(exp))
            return true;
        return exp * 1000 <= nowMs + refreshWindowMs;
    }
    catch {
        return true;
    }
}
export const isMapKitTokenExpired = isJwtExpired;
//# sourceMappingURL=jwt.js.map