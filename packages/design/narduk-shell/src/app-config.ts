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

/** One `base` class string, appended to a Nuxt UI slot or size variant. */
interface NardukShellBaseClass {
  base: string
}

type NardukShellFieldSizes = Record<'xs' | 'sm', NardukShellBaseClass>

/** The Nuxt UI form controls whose `xs`/`sm` sizes ship 14px text. */
const FIELD_COMPONENTS = [
  'input',
  'inputMenu',
  'inputNumber',
  'inputTags',
  'select',
  'selectMenu',
  'textarea',
] as const

export interface NardukShellUiAppConfig {
  colors: NardukShellColorAliases
  button: { slots: NardukShellBaseClass; variants: { square: { true: string } } }
  input: { variants: { size: NardukShellFieldSizes } }
  inputMenu: { variants: { size: NardukShellFieldSizes } }
  inputNumber: { variants: { size: NardukShellFieldSizes } }
  inputTags: { variants: { size: NardukShellFieldSizes } }
  select: { variants: { size: NardukShellFieldSizes } }
  selectMenu: { variants: { size: NardukShellFieldSizes } }
  textarea: { variants: { size: NardukShellFieldSizes } }
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
/**
 * iOS Safari zooms the page when a focused field renders below 16px, so the
 * small sizes are 16px on a phone and keep their 14px from `sm:` up. (The `md`
 * and larger sizes are already `text-base`.) `text-base` drops the size's
 * `/line-height`, which is what we want: 1.5 is the right leading at 16px.
 */
const MOBILE_SAFE_FIELD_TEXT = 'text-base sm:text-sm'

const fieldSizes = (): NardukShellFieldSizes => ({
  xs: { base: MOBILE_SAFE_FIELD_TEXT },
  sm: { base: MOBILE_SAFE_FIELD_TEXT },
})

/**
 * Tap targets are 44px on a coarse pointer (mobile web QA rule 8). It is a
 * theme class and not base CSS because a Tailwind utility outranks any base
 * rule: a `size-8` icon button would otherwise win. `--ns-tap-min` is the
 * narduk-ui token; the fallback keeps the class valid without it.
 */
const COARSE_POINTER_TAP_TARGET =
  'pointer-coarse:min-h-[var(--ns-tap-min,44px)] pointer-coarse:min-w-[var(--ns-tap-min,44px)]'

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
    button: {
      slots: { base: COARSE_POINTER_TAP_TARGET },
      // The minimum width widens an icon-only button, so its icon has to stay centred.
      variants: { square: { true: 'justify-center' } },
    },
    ...(Object.fromEntries(
      FIELD_COMPONENTS.map((name) => [name, { variants: { size: fieldSizes() } }]),
    ) as Pick<NardukShellUiAppConfig, (typeof FIELD_COMPONENTS)[number]>),
  },
}
