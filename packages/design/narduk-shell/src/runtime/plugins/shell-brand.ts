/**
 * Applies `nardukShell.accent` / `.structure` app-wide (components backlog
 * item 18, narduk-libs#265).
 *
 * Reads the values from `app.config`, where the module merged them as a
 * default, so an app's own `app/app.config.ts` still wins; and writes them as
 * one head `<style>` (see `../utils/shell-brand.ts` for why the head, and why
 * that selector list). When neither value is set, the style list is empty and
 * nothing is overridden.
 *
 * The style is a `computed`, so a runtime change to `app.config` (HMR in
 * development, or `updateAppConfig()`) re-renders it.
 */
import { computed } from 'vue'

import { defineNuxtPlugin, useAppConfig, useHead } from '#imports'

import {
  NARDUK_SHELL_CONFIG_KEY,
  readShellAppConfig,
} from '../composables/use-narduk-shell-sections'
import { safeBrandValue, shellBrandCss } from '../utils/shell-brand'

/** The `<style>`'s dedupe key, so a second install cannot stack two rules. */
export const SHELL_BRAND_STYLE_KEY = 'narduk-shell-brand'

/**
 * The plugin body, exported so a test can run it inside an app of its own
 * without a Nuxt runtime.
 */
export function applyShellBrand(): void {
  const appConfig = useAppConfig()
  const brand = computed(() => readShellAppConfig(appConfig))

  if (import.meta.dev) {
    for (const token of ['accent', 'structure'] as const) {
      const value = brand.value[token]
      if (value !== undefined && safeBrandValue(value) === undefined) {
        console.warn(
          `[narduk-shell] ${NARDUK_SHELL_CONFIG_KEY}.${token} ${JSON.stringify(value)} is not a CSS colour value and was ignored.`,
        )
      }
    }
  }

  useHead({
    style: computed(() => {
      const css = shellBrandCss(brand.value)
      return css ? [{ key: SHELL_BRAND_STYLE_KEY, textContent: css }] : []
    }),
  })
}

export default defineNuxtPlugin(applyShellBrand)
