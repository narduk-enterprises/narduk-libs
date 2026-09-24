/**
 * The SSR preload tag (§c.7).
 *
 * `renderHTMLAttributes()` is Apple's own generator for the `<script>` that
 * starts `mapkit.core.js` downloading as the HTML is parsed; `load()` then
 * adopts the tag rather than injecting a second one (it looks the tag up by
 * `data-callback="initMapKitLoaderV2"` in `document.head`).
 *
 * **Server render only** (narduk-libs#469). Through 2.1.2 the same `useHead()`
 * also ran on the client, which put the tag in the hands of a second owner:
 * unhead's client renderer. The entry has no key, so unhead adopts the
 * server's element only if a hash of EVERY attribute on it matches the entry.
 * Under a nonce CSP they never match -- the server stamps `nonce` on the tag
 * and the browser hides it as `nonce=""` -- so unhead appended a second
 * `mapkit.core.js` ("Mapkit namespace already exists"). On the client the
 * loader alone owns the tag: it adopts the server's (SSR page load) or injects
 * the only one (client-side navigation, `<ClientOnly>`).
 *
 * **Emitted without a `token`.** A token in the tag is MapKit's static,
 * non-refreshable path -- and a portal token that works on a preview host has,
 * by definition, no origin restriction on it at all. The tag's whole job is the
 * download; the exchange still happens through `authorizationCallback`.
 *
 * It is emitted from `<AppMapKit>`'s own `setup`, not from the module into
 * `app.head`, so a page that renders no map issues no request to
 * `cdn.apple-mapkit.com`.
 */
import { renderHTMLAttributes } from '@apple/mapkit-loader';
import { useHead } from '#imports';
import { readMapKitPublicOptions, resolveMapKitRuntimeOptions } from './options.js';
export function useMapKitPreload(options = {}) {
    // Same server test as `useMapKit()`, which starts the loader only where this
    // returns early.
    if (typeof window !== 'undefined')
        return;
    if (readMapKitPublicOptions().ssrPreload === false)
        return;
    const resolved = resolveMapKitRuntimeOptions({
        ...(options.language === undefined ? {} : { language: options.language }),
        ...(options.libraries === undefined ? {} : { libraries: options.libraries }),
    });
    const attributes = renderHTMLAttributes({
        libraries: [...resolved.libraries],
        version: '6',
        ...(resolved.language === undefined ? {} : { language: resolved.language }),
        ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    });
    useHead({ script: [attributes] });
}
//# sourceMappingURL=preload.js.map