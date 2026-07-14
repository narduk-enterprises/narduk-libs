import { isJwtExpired } from '../token/jwt.js';
/**
 * Converts an explicitly supplied environment binding object into runtime
 * configuration. This function never reads `process.env` and is safe in
 * Cloudflare Workers and other Web-standard runtimes.
 */
export function mapKitConfigFromEnv(env = {}) {
    const config = {};
    if (env.MAPKIT_ALLOWED_ORIGINS)
        config.allowedOrigins = env.MAPKIT_ALLOWED_ORIGINS;
    if (env.APPLE_KEY_ID)
        config.keyId = env.APPLE_KEY_ID;
    const privateKey = env.APPLE_PRIVATE_KEY || env.APPLE_SECRET_KEY;
    if (privateKey)
        config.privateKey = privateKey;
    const staticToken = env.APPLE_MAPKIT_TOKEN || env.MAPKIT_TOKEN;
    if (staticToken)
        config.staticToken = staticToken;
    if (env.APPLE_TEAM_ID)
        config.teamId = env.APPLE_TEAM_ID;
    return config;
}
export function parseAllowedOrigins(input) {
    if (Array.isArray(input)) {
        return input.map((origin) => origin.trim()).filter(Boolean);
    }
    if (typeof input !== 'string')
        return [];
    if (!input.trim())
        return [];
    return input
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}
export function isOriginAllowed(origin, allowedOrigins) {
    if (allowedOrigins.length === 0)
        return true;
    const normalizedOrigin = origin.replace(/\/$/, '');
    return allowedOrigins.some((allowed) => allowed.replace(/\/$/, '') === normalizedOrigin);
}
export function hasSigningConfig(config) {
    return Boolean(config.privateKey?.trim() && config.teamId?.trim() && config.keyId?.trim());
}
export function hasUsableStaticToken(config) {
    const token = config.staticToken?.trim();
    return Boolean(token?.startsWith('eyJ') && !isJwtExpired(token));
}
//# sourceMappingURL=shared-config.js.map