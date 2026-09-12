/**
 * The suite's Nuxt UI `app.config` preset.
 *
 * Components-library backlog item 2 (narduk-libs#249). `theme.css` owns the
 * structural half of the look — surfaces, ink, borders, radius, shadow, type —
 * by pointing Nuxt UI's `--ui-*` variables at the NE tokens. This file owns the
 * half that is not expressible as a CSS variable: the colour *aliases*, which
 * Nuxt UI expands into eleven-shade scales at build time.
 *
 * The module merges this as a **default** (`defu`, so an existing value wins),
 * which means the consuming app's own `app/app.config.ts` always overrides it.
 * `@narduk-enterprises/narduk-core` also defaults `ui.colors`; when both are
 * installed, whichever module's `setup` runs first supplies the value and the
 * other leaves it alone. An app that cares sets the alias itself rather than
 * depending on module order.
 */

/** Colour aliases Nuxt UI expands into `--ui-color-<alias>-<shade>` scales. */
export interface NardukShellColorAliases {
  /** Interaction and brand chrome for `U*` primitives. */
  primary: string
  /** The grey ramp Nuxt UI falls back to wherever the NE bridge does not reach. */
  neutral: string
}

export interface NardukShellUiAppConfig {
  colors: NardukShellColorAliases
}

export interface NardukShellAppConfig {
  ui: NardukShellUiAppConfig
}

/**
 * Radius is deliberately absent. Nuxt UI 4 has no `ui.radius` app-config key —
 * every radius derives from the `--ui-radius` custom property, which
 * `theme.css` bridges to `--ne-radius-base` (`rounded-md` is the NE control
 * radius, `rounded-lg` the NE panel radius). Setting radius here would be a
 * second, silently-ignored source of truth.
 */
export const NARDUK_SHELL_APP_CONFIG: NardukShellAppConfig = {
  ui: {
    colors: {
      // `sky` is the Tailwind ramp closest to the NE accent, so a `soft` or
      // `subtle` U* variant tints in the same family as `--ne-accent`.
      primary: 'sky',
      // Nuxt UI's own default, restated so a future change upstream cannot
      // quietly warm the suite's greys: NE's ink and surfaces are cool.
      neutral: 'slate',
    },
  },
}
