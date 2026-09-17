import { hasSigningConfig, hasUsableStaticToken, mapKitConfigFromEnv as mapKitConfigFromExplicitEnv, } from './shared-config.js';
export { hasSigningConfig, hasUsableStaticToken, isOriginAllowed, parseAllowedOrigins, } from './shared-config.js';
const DEFAULT_DOPPLER_PROJECT = 'narduk';
const DEFAULT_DOPPLER_CONFIG = 'tokens';
const DEFAULT_DOPPLER_TIMEOUT_MS = 10_000;
export function readProcessEnv() {
    if (typeof process === 'undefined')
        return {};
    // Read it as the string dictionary it is. `NodeJS.ProcessEnv` is declared
    // with an index signature and no properties of its own, but any package in
    // the type graph may augment it with an optional key of its own
    // (autoprefixer's AUTOPREFIXER_GRID, browserslist's BROWSERSLIST*). The
    // moment one does, `MapKitEnv` -- whose keys are all optional -- becomes a
    // weak type with no property in common with it, and the direct assignment
    // stops compiling for a reason that has nothing to do with either type.
    const env = process.env;
    return env;
}
export function mapKitConfigFromEnv(env = readProcessEnv()) {
    return mapKitConfigFromExplicitEnv(env);
}
export async function resolveMapKitServerConfig(config = {}, env) {
    const resolvedConfig = mergeMapKitConfig(mapKitConfigFromEnv(env), config);
    if (hasSigningConfig(resolvedConfig) || hasUsableStaticToken(resolvedConfig)) {
        return resolvedConfig;
    }
    if (config.doppler === false || config.doppler?.enabled === false) {
        return resolvedConfig;
    }
    const dopplerConfig = await mapKitConfigFromDoppler(config.doppler ?? {});
    return mergeMapKitConfig(dopplerConfig, resolvedConfig);
}
export async function mapKitConfigFromDoppler(options = {}) {
    const entries = await readDopplerSecrets([
        'APPLE_TEAM_ID',
        'APPLE_KEY_ID',
        'APPLE_PRIVATE_KEY',
        'APPLE_SECRET_KEY',
        'APPLE_MAPKIT_TOKEN',
        'MAPKIT_TOKEN',
        'MAPKIT_ALLOWED_ORIGINS',
    ], options);
    const config = {};
    if (entries.APPLE_TEAM_ID)
        config.teamId = entries.APPLE_TEAM_ID;
    if (entries.APPLE_KEY_ID)
        config.keyId = entries.APPLE_KEY_ID;
    const privateKey = entries.APPLE_PRIVATE_KEY || entries.APPLE_SECRET_KEY;
    if (privateKey)
        config.privateKey = privateKey;
    const staticToken = entries.APPLE_MAPKIT_TOKEN || entries.MAPKIT_TOKEN;
    if (staticToken)
        config.staticToken = staticToken;
    if (entries.MAPKIT_ALLOWED_ORIGINS)
        config.allowedOrigins = entries.MAPKIT_ALLOWED_ORIGINS;
    return config;
}
function mergeMapKitConfig(fallback, preferred) {
    return {
        ...fallback,
        ...preferred,
    };
}
async function readDopplerSecrets(keys, options) {
    // Bounded parallel reads over a fixed, caller-supplied list of secret NAMES
    // -- not an N+1 query over rows. Believed a false positive.
    const results = await Promise.all(
    // eslint-disable-next-line narduk/no-map-async-in-server -- narduk-libs#138
    keys.map(async (key) => [key, await readDopplerSecret(key, options)]));
    return Object.fromEntries(results);
}
async function readDopplerSecret(key, options) {
    try {
        const [{ execFile }, { promisify }] = await Promise.all([
            import('node:child_process'),
            import('node:util'),
        ]);
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync(options.command ?? 'doppler', [
            'secrets',
            'get',
            key,
            '--plain',
            '--no-check-version',
            '--no-exit-on-missing-secret',
            '--project',
            options.project ?? DEFAULT_DOPPLER_PROJECT,
            '--config',
            options.config ?? DEFAULT_DOPPLER_CONFIG,
        ], {
            timeout: options.timeoutMs ?? DEFAULT_DOPPLER_TIMEOUT_MS,
        });
        const value = stdout.trim();
        return value.length > 0 ? value : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=config.js.map