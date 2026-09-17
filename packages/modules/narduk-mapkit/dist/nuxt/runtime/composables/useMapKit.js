/**
 * `useMapKit()` -- one MapKit JS initialization per page, shared by every map.
 *
 * ## What changed from the 2.0.x adapter
 *
 * - `libraries` is real configuration instead of a hard-coded
 *   `['map', 'annotations', 'overlays']`. MapKit JS 6 loads nothing by default,
 *   so the list decides what the page downloads; an app that draws only pins
 *   should not be paying for `overlays`.
 * - The failure is a structured `MapKitFailure`, not a string. `#error` renders
 *   the code and Apple's `originMismatch` diagnostic, which is the single most
 *   useful string for a misconfigured preview host.
 * - `retry()` exists. MapKit never re-asks for a token after a rejection --
 *   measured 2026-09-17: three `/ma/bootstrap` attempts with the SAME token,
 *   one `authorizationCallback`, then `Unauthorized`. Recovery is ours.
 */
import { readonly, ref, shallowRef } from 'vue';
import { initializeMapKit } from '../../../client/mapkit.js';
import { resolveMapKitRuntimeOptions } from '../options.js';
const failure = ref(null);
const namespace = shallowRef(null);
const ready = ref(false);
let pending = null;
/** Test seam: the singleton is module state, so a suite has to be able to clear it. */
export function resetMapKitComposableStateForTests() {
    failure.value = null;
    namespace.value = null;
    ready.value = false;
    pending = null;
}
function start(options) {
    if (pending)
        return;
    const resolved = resolveMapKitRuntimeOptions(options);
    failure.value = null;
    pending = initializeMapKit({
        libraries: resolved.libraries,
        tokenEndpoint: resolved.tokenEndpoint,
        ...(resolved.language === undefined ? {} : { language: resolved.language }),
        onFailure: (next) => {
            failure.value = next;
        },
    });
    void pending.then((loaded) => {
        namespace.value = loaded;
        ready.value = true;
        failure.value = null;
    }, (cause) => {
        // `initializeMapKit` already reported the structured failure through
        // `onFailure`; this only makes the next call able to try again.
        pending = null;
        ready.value = false;
        failure.value ??= {
            message: cause instanceof Error ? cause.message : String(cause),
            source: 'mapkit',
            status: 'Unknown',
        };
    });
}
export function useMapKit(options = {}) {
    // Nothing loads MapKit during SSR: `renderHTMLAttributes()` (emitted by the
    // module without a token) is the only thing that reaches the server.
    if (typeof window !== 'undefined')
        start(options);
    return {
        failure: readonly(failure),
        mapkit: readonly(namespace),
        ready: readonly(ready),
        retry: () => {
            pending = null;
            ready.value = false;
            namespace.value = null;
            start(options);
        },
    };
}
//# sourceMappingURL=useMapKit.js.map