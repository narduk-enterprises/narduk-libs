import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseUpgradeOrigin } from './worker/upgrade-origin.js';
import { parseUpgradePath } from './worker/upgrade-path.js';
import { NARDUK_ROUTER_HEADER_PREFIX } from './worker/principal.js';
/**
 * A JavaScript identifier. The class name is emitted verbatim into a generated
 * `export { <name> } from '...'` statement, so anything else would turn a
 * configuration typo into a rollup parse error with no useful location.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u;
/**
 * Extensions probed when a relative Durable Object module path is given without
 * one. Nitro's rollup resolver would find these itself, but resolving here lets
 * a missing module fail at configuration time with the path that was tried.
 */
const MODULE_SUFFIXES = ['', '.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.js'];
function isFile(candidate) {
    try {
        return statSync(candidate).isFile();
    }
    catch {
        return false;
    }
}
export class NardukRealtimeConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NardukRealtimeConfigurationError';
    }
}
/**
 * Resolve a configured module path, or explain what was tried.
 *
 * `label` names the option in the error message -- the same routine serves
 * `realtime.durableObjects.<Class>` and `realtime.upgrades[n].authorize`.
 */
function resolveModulePath(label, modulePath, rootDir) {
    // A bare specifier (`@scope/package/durable`) is left to the bundler: it is
    // resolved from the app's own node_modules, which this module cannot probe
    // reliably from inside a pnpm store.
    if (!modulePath.startsWith('.') && !isAbsolute(modulePath))
        return modulePath;
    const base = isAbsolute(modulePath) ? modulePath : resolve(rootDir, modulePath);
    // `isFile`, not `existsSync`: a bare `./server/durable/tenant` is a directory
    // on disk, and the entry point wanted there is `tenant/index.ts`.
    const found = MODULE_SUFFIXES.map((suffix) => base + suffix).find((candidate) => isFile(candidate));
    if (!found) {
        throw new NardukRealtimeConfigurationError(`${label} points at "${modulePath}", which does not resolve to a file. Tried: ${MODULE_SUFFIXES.map((suffix) => base + suffix).join(', ')}.`);
    }
    return found;
}
/**
 * Validate and resolve the `realtime.durableObjects` map.
 *
 * Entries are returned sorted by class name so that the generated Worker entry
 * is byte-identical across builds of the same configuration.
 */
export function resolveDurableObjects(durableObjects, rootDir) {
    return Object.entries(durableObjects)
        .map(([className, modulePath]) => {
        if (!IDENTIFIER_PATTERN.test(className)) {
            throw new NardukRealtimeConfigurationError(`realtime.durableObjects key "${className}" is not a valid JavaScript identifier. Use the exported class name, for example "VesselDO".`);
        }
        if (typeof modulePath !== 'string' || modulePath.trim().length === 0) {
            throw new NardukRealtimeConfigurationError(`realtime.durableObjects.${className} needs a module path, for example "./server/durable/vessel-do".`);
        }
        return {
            className,
            modulePath: resolveModulePath(`realtime.durableObjects.${className}`, modulePath.trim(), rootDir),
        };
    })
        .sort((left, right) => (left.className < right.className ? -1 : 1));
}
/** A header field name, per RFC 9110 token. */
const HEADER_TOKEN_PATTERN = /^[!#$%&'*+.^`|~\w-]+$/u;
/** `idFrom` values of this shape address one fixed object rather than a param. */
const LITERAL_ID_PREFIX = 'name:';
function requireNonEmptyString(value, label, example) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new NardukRealtimeConfigurationError(`${label} needs a value, for example ${example}.`);
    }
    return value.trim();
}
function resolveForwardHeaders(forwardHeaders, label) {
    if (forwardHeaders === undefined)
        return [];
    if (!Array.isArray(forwardHeaders)) {
        throw new NardukRealtimeConfigurationError(`${label} must be an array of header names, for example ["cf-connecting-ip"].`);
    }
    const resolved = [];
    for (const entry of forwardHeaders) {
        const name = requireNonEmptyString(entry, label, '"cf-connecting-ip"').toLowerCase();
        if (!HEADER_TOKEN_PATTERN.test(name)) {
            throw new NardukRealtimeConfigurationError(`${label} contains "${name}", which is not a header name.`);
        }
        // The router strips this prefix from every inbound request so a Durable
        // Object can trust what it finds there. Letting an app forward one back in
        // would hand that channel to whoever set the header.
        if (name.startsWith(NARDUK_ROUTER_HEADER_PREFIX)) {
            throw new NardukRealtimeConfigurationError(`${label} lists "${name}". The "${NARDUK_ROUTER_HEADER_PREFIX}" prefix is the upgrade router's own trust channel and is always stripped from an inbound request; return the value from the route's authorize module instead.`);
        }
        if (!resolved.includes(name))
            resolved.push(name);
    }
    return resolved;
}
/**
 * Read an optional boolean option.
 *
 * `false` resolves to `undefined`: only an opt-in is carried into the generated
 * Worker entry, so its output is identical for a flag left off and one written
 * out as `false`.
 */
function resolveFlag(value, label) {
    if (value === undefined || value === false)
        return undefined;
    if (value !== true) {
        throw new NardukRealtimeConfigurationError(`${label} must be true or false.`);
    }
    return true;
}
/** Validate and normalise `allowedOrigins`, or explain what is wrong with one. */
function resolveAllowedOrigins(allowedOrigins, label) {
    if (allowedOrigins === undefined)
        return undefined;
    if (!Array.isArray(allowedOrigins)) {
        throw new NardukRealtimeConfigurationError(`${label} must be an array of origins, for example ["https://app.example"].`);
    }
    if (allowedOrigins.length === 0) {
        throw new NardukRealtimeConfigurationError(`${label} is empty. Remove it to keep the same-origin default, or list at least one origin.`);
    }
    const resolved = [];
    for (const entry of allowedOrigins) {
        const raw = requireNonEmptyString(entry, label, '"https://app.example"');
        const parsed = parseUpgradeOrigin(raw);
        if (!parsed.ok) {
            throw new NardukRealtimeConfigurationError(`${label} lists "${raw}": it ${parsed.reason}.`);
        }
        if (!resolved.includes(parsed.origin))
            resolved.push(parsed.origin);
    }
    return resolved;
}
function resolveIdFrom(idFrom, params, label) {
    if (idFrom.startsWith(LITERAL_ID_PREFIX)) {
        if (idFrom.slice(LITERAL_ID_PREFIX.length).trim().length === 0) {
            throw new NardukRealtimeConfigurationError(`${label} is "${idFrom}" with no name after the prefix. Use "name:<literal>", for example "name:fleet".`);
        }
        return idFrom;
    }
    if (!params.includes(idFrom)) {
        throw new NardukRealtimeConfigurationError(`${label} is "${idFrom}", which the route path does not declare. Declared parameters: ${params.length > 0 ? params.map((name) => `:${name}`).join(', ') : '(none)'}. Use "name:${idFrom}" for a fixed object name.`);
    }
    return idFrom;
}
/**
 * Validate and resolve `realtime.upgrades`.
 *
 * Everything that can be known at configuration time is checked here -- the
 * path pattern, the binding name, that `idFrom` names a parameter the path
 * actually declares, the forwarded-header allowlist, the origin policy, that an
 * authoriser is declared at all, and that the `authorize` module exists -- so a typo fails `nuxt build` immediately instead of becoming
 * a 500 on a deployed upgrade. Declaration order is preserved: the first
 * matching route wins at runtime.
 */
export function resolveUpgrades(upgrades, rootDir) {
    if (upgrades === undefined)
        return [];
    if (!Array.isArray(upgrades)) {
        throw new NardukRealtimeConfigurationError('realtime.upgrades must be an array of { path, binding, idFrom } entries.');
    }
    const seen = new Set();
    return upgrades.map((upgrade, index) => {
        const label = `realtime.upgrades[${index}]`;
        if (typeof upgrade !== 'object' || upgrade === null) {
            throw new NardukRealtimeConfigurationError(`${label} must be an object with { path, binding, idFrom }.`);
        }
        const path = requireNonEmptyString(upgrade.path, `${label}.path`, '"/api/live/:id"');
        const parsed = parseUpgradePath(path);
        if (!parsed.ok) {
            throw new NardukRealtimeConfigurationError(`${label}.path "${path}" ${parsed.reason}.`);
        }
        if (seen.has(path)) {
            throw new NardukRealtimeConfigurationError(`${label}.path "${path}" is declared twice. Only the first would ever match.`);
        }
        seen.add(path);
        const binding = requireNonEmptyString(upgrade.binding, `${label}.binding`, '"VESSEL_DO"');
        if (!IDENTIFIER_PATTERN.test(binding)) {
            throw new NardukRealtimeConfigurationError(`${label}.binding "${binding}" is not a valid binding name. Use the name from wrangler's durable_objects.bindings[].name, for example "VESSEL_DO".`);
        }
        const idFrom = resolveIdFrom(requireNonEmptyString(upgrade.idFrom, `${label}.idFrom`, '"vesselId" or "name:fleet"'), parsed.params, `${label}.idFrom`);
        const resolved = {
            path,
            binding,
            idFrom,
            forwardHeaders: resolveForwardHeaders(upgrade.forwardHeaders, `${label}.forwardHeaders`),
        };
        if (upgrade.authorize !== undefined) {
            resolved.authorizeModulePath = resolveModulePath(`${label}.authorize`, requireNonEmptyString(upgrade.authorize, `${label}.authorize`, '"./server/upgrades/live"'), rootDir);
        }
        const allowUnauthenticated = resolveFlag(upgrade.allowUnauthenticated, `${label}.allowUnauthenticated`);
        // Fail closed: an omitted authoriser forwards every matching handshake to the
        // object, so it has to be a written decision rather than a default.
        if (resolved.authorizeModulePath === undefined && allowUnauthenticated === undefined) {
            throw new NardukRealtimeConfigurationError(`${label}.authorize is missing for "${path}", so every matching upgrade would reach the Durable Object unauthenticated. Set ${label}.authorize to the module that decides the upgrade, or ${label}.allowUnauthenticated: true if the object authorises the socket itself.`);
        }
        if (allowUnauthenticated !== undefined)
            resolved.allowUnauthenticated = allowUnauthenticated;
        const allowedOrigins = resolveAllowedOrigins(upgrade.allowedOrigins, `${label}.allowedOrigins`);
        if (allowedOrigins !== undefined)
            resolved.allowedOrigins = allowedOrigins;
        const allowMissingOrigin = resolveFlag(upgrade.allowMissingOrigin, `${label}.allowMissingOrigin`);
        if (allowMissingOrigin !== undefined)
            resolved.allowMissingOrigin = allowMissingOrigin;
        return resolved;
    });
}
//# sourceMappingURL=options.js.map