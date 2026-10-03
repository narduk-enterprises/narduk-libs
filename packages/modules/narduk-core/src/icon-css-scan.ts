/**
 * narduk-libs#1379: `@nuxt/icon` in css mode (the default, and what every
 * narduk app uses) mounts `NuxtIconCss`, and each instance's `setup` calls
 * `getAllSelectors()` on the client. The first call reads every rule of every
 * stylesheet in `document.styleSheets` to learn which `.i-<collection>:<name>`
 * classes already exist, so it does not inject a second copy. On a real app
 * (a 194 KB Tailwind and Nuxt UI entry sheet, 4x CPU throttle) that single
 * scan is about 10% of the hydration task, and it grows with the stylesheet.
 *
 * What the scan guards against is a duplicate `<style>` for an icon. Without
 * `UnoCSS`, an icon class exists in exactly two places: the `<style>` the
 * server emitted for the icons it rendered, or a `<style>` this component
 * injected itself. Both are inline `<style>` text, so a substring check of the
 * inline styles answers the same question without parsing a stylesheet into
 * the CSSOM. `serverKnownCssClasses` (the one case where an icon rule lives in
 * a linked stylesheet) only fills when UnoCSS is installed, and then the
 * transform stands down and the upstream scan runs unchanged.
 *
 * A miss is handled exactly as upstream handles one: mount the rule. Icons
 * that render the same pixels, in the same order, with the same markup.
 */

/** Matches the installed css-mode runtime, in a pnpm or a flat `node_modules`. */
export const NUXT_ICON_CSS_RUNTIME =
  /[\\/]@nuxt[\\/]icon[\\/]dist[\\/]runtime[\\/]components[\\/]css\.js(?:\?|$)/

/** The one call site that triggers the scan in `@nuxt/icon` 2.5.1. */
const SCAN_CALL = 'const selectors = getAllSelectors();'

/**
 * Replaces the stylesheet scan with an inline-style lookup. `undefined` when
 * the upstream source no longer has the call site this patch knows (a
 * `@nuxt/icon` bump), so the caller keeps the upstream behaviour.
 */
export function patchNuxtIconCssRuntime(code: string): string | undefined {
  if (!code.includes(SCAN_CALL)) return undefined
  return `${code.replace(SCAN_CALL, 'const selectors = nardukInlineIconSelectors();')}
// narduk-libs#1379: dedupe against inline <style> text, not the CSSOM.
const nardukInjectedSelectors = new Set();
function nardukInlineHas(selector) {
  if (typeof document === "undefined") return false;
  const open = selector + "{";
  const close = selector + ")";
  for (const style of document.querySelectorAll("style")) {
    const text = style.textContent;
    if (text && (text.includes(close) || text.includes(open))) return true;
  }
  return false;
}
function nardukInlineIconSelectors() {
  return {
    has(selector) {
      if (nardukInjectedSelectors.has(selector)) return true;
      if (!nardukInlineHas(selector)) return false;
      nardukInjectedSelectors.add(selector);
      return true;
    },
    add(selector) {
      nardukInjectedSelectors.add(selector);
    },
  };
}
`
}

interface TransformContext {
  warn: (message: string) => void
}

interface ResolvedViteConfig {
  plugins?: ReadonlyArray<{ name?: string } | null | false | undefined>
}

/**
 * Vite plugin applying {@link patchNuxtIconCssRuntime}. Stands down (upstream
 * behaviour, scan included) under UnoCSS, or when
 * `NARDUK_ICON_CSS_SCAN=upstream` is set.
 */
export function nardukIconCssScanPlugin() {
  let standDown = process.env.NARDUK_ICON_CSS_SCAN === 'upstream'
  let warned = false
  return {
    name: 'narduk-icon-css-scan',
    enforce: 'pre' as const,
    configResolved(config: ResolvedViteConfig) {
      if (config.plugins?.some((plugin) => plugin && plugin.name?.startsWith('unocss:'))) {
        standDown = true
      }
    },
    transform(this: TransformContext, code: string, id: string, options?: { ssr?: boolean }) {
      // The scan is client-only code; the server build keeps upstream source.
      if (options?.ssr || standDown || !NUXT_ICON_CSS_RUNTIME.test(id)) return null
      const patched = patchNuxtIconCssRuntime(code)
      if (patched === undefined) {
        if (!warned) {
          warned = true
          this.warn(
            '[@narduk-enterprises/narduk-core] @nuxt/icon css.js no longer matches the icon-scan ' +
              'patch (narduk-libs#1379); the upstream stylesheet scan stays on the hydration path.',
          )
        }
        return null
      }
      return { code: patched, map: null }
    },
  }
}

/** Registers the plugin once when narduk-core installs `@nuxt/icon`. */
export function addIconCssScanPlugin(nuxtOptions: { vite?: { plugins?: unknown[] } }): void {
  const vite = (nuxtOptions.vite ??= {})
  vite.plugins ??= []
  if (
    vite.plugins.some(
      (plugin) => (plugin as { name?: string } | null)?.name === 'narduk-icon-css-scan',
    )
  ) {
    return
  }
  vite.plugins.push(nardukIconCssScanPlugin())
}
