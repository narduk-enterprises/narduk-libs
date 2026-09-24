/**
 * Registers the app files a Nuxt *module* renders with Tailwind and with Nuxt
 * UI's component detection (narduk-libs#700).
 *
 * Nuxt UI writes `#build/ui.css` with an `@source` for every Nuxt *layer*'s
 * `app/` directory, and `ui.experimental.componentDetection` scans only those
 * layer directories for the `U*` components an app renders. A module is not a
 * layer, so neither sees the pages, layouts and components it adds: a utility
 * such as `min-h-dvh` existed only when some Nuxt UI theme happened to name it,
 * and with detection on, a `UCard` rendered only by a module lost its theme.
 *
 * `registerNuxtUiSources` closes both gaps once every module is installed:
 *
 * - it prepends an `@source` line per directory to Nuxt UI's `ui.css`
 *   template, which every stylesheet that imports `@nuxt/ui` pulls in, so the
 *   app's own `main.css` scans the module's files too. The paths are absolute,
 *   resolved from the installed package, so they point into `node_modules`
 *   for a packed install; an explicit `@source` is scanned even there.
 * - when the app turned `componentDetection` on, it adds the module's
 *   components to the detection list. `true` becomes that list, which Nuxt UI
 *   treats as "detect, and always include these".
 *
 * Nothing changes for an app without Nuxt UI or with detection off.
 *
 * ```ts
 * import { registerNuxtUiSources } from '@narduk-enterprises/narduk-core/nuxt-ui-sources'
 *
 * registerNuxtUiSources(nuxt, {
 *   sources: [resolver.resolve('../app')],
 *   components: ['Button', 'Card'],
 * })
 * ```
 */

/** The template Nuxt UI generates its `@source` lines into. */
export const NUXT_UI_CSS_TEMPLATE = 'ui.css'

export interface NuxtUiSourceRegistration {
  /** Nuxt UI component names without the prefix, e.g. `'Button'` for `UButton`. */
  readonly components?: readonly string[]
  /** Absolute directories or files Tailwind scans for utility classes. */
  readonly sources?: readonly string[]
}

interface CssTemplate {
  filename?: string
  getContents?: (data: never) => string | Promise<string>
}

interface NuxtUiOptionsLike {
  experimental?: {
    componentDetection?: boolean | string[]
  }
}

export interface NuxtUiSourcesHost {
  hook: (name: 'modules:done', handler: () => void) => unknown
  options: {
    build?: { templates?: CssTemplate[] }
    ui?: unknown
  }
}

/** One `@source` line per path, quoted for CSS, with POSIX separators. */
export function tailwindSourceLines(sources: readonly string[]): string {
  return sources
    .map((source) => `@source ${JSON.stringify(source.replaceAll('\\', '/'))};`)
    .join('\n')
}

/**
 * Prepends `@source` lines to Nuxt UI's `ui.css` template. Returns whether the
 * template was found: an app without Nuxt UI has none, and needs none.
 */
export function extendNuxtUiCssSources(
  templates: CssTemplate[],
  sources: readonly string[],
): boolean {
  const template = templates.find(
    (candidate) => candidate.filename === NUXT_UI_CSS_TEMPLATE && candidate.getContents,
  )
  if (!template?.getContents || sources.length === 0) return Boolean(template)

  const getContents = template.getContents
  const lines = tailwindSourceLines(sources)
  template.getContents = async (data: never) => `${lines}\n${await getContents(data)}`
  return true
}

/**
 * Adds components to `ui.experimental.componentDetection` when it is on. It
 * assigns a new array rather than pushing, so an app's own config array is
 * never mutated.
 */
export function extendNuxtUiComponentDetection(ui: unknown, components: readonly string[]): void {
  const experimental = (ui as NuxtUiOptionsLike | undefined)?.experimental
  const detection = experimental?.componentDetection
  if (!experimental || !detection || components.length === 0) return

  const current = Array.isArray(detection) ? detection : []
  experimental.componentDetection = [...new Set([...current, ...components])]
}

export function registerNuxtUiSources(
  nuxt: NuxtUiSourcesHost,
  registration: NuxtUiSourceRegistration,
): void {
  // Nuxt UI adds its template and publishes its resolved options as
  // `nuxt.options.ui` during its own setup, which may run after this module's;
  // it reads both only when templates are generated, after `modules:done`.
  nuxt.hook('modules:done', () => {
    extendNuxtUiCssSources(nuxt.options.build?.templates ?? [], registration.sources ?? [])
    extendNuxtUiComponentDetection(nuxt.options.ui, registration.components ?? [])
  })
}
