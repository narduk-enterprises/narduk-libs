/**
 * Registers narduk-shell's runtime with Tailwind and with Nuxt UI's component
 * detection (narduk-libs#978).
 *
 * Nuxt UI writes `#build/ui.css` with an `@source` for every Nuxt *layer*'s
 * `app/` directory, and Tailwind's automatic detection skips `node_modules`.
 * narduk-shell is a module, so without this neither sees `src/runtime`: a
 * utility that only a `Ne*` component uses (`NeCard`'s `tabular-nums`, a
 * marketing section's `text-[var(--ne-accent)]`) was never generated in a
 * consuming app. With `ui.experimental.componentDetection` on, the `U*`
 * components the suite renders also lost their themes.
 *
 * This is narduk-core's `registerNuxtUiSources` (narduk-libs#700), which
 * narduk-auth uses. narduk-shell does not depend on narduk-core, so the
 * thirty lines are carried here rather than taking that dependency for them.
 */

/** The template Nuxt UI generates its `@source` lines into. */
export const NUXT_UI_CSS_TEMPLATE = 'ui.css'

/**
 * The Nuxt UI components `src/runtime` names, without the `U` prefix: what
 * Nuxt UI's detection would find there if this package were a layer.
 * `test/nuxt-ui-sources.test.ts` rescans the runtime with Nuxt UI's own
 * pattern and fails when this list drifts from the files.
 */
export const SHELL_NUXT_UI_COMPONENTS = [
  'Alert',
  'App',
  'Badge',
  'Breadcrumb',
  'Button',
  'Card',
  'DashboardGroup',
  'DashboardNavbar',
  'DashboardPanel',
  'DashboardSidebar',
  'Empty',
  'Form',
  'FormField',
  'Input',
  'Modal',
  'NavigationMenu',
  'OverlayProvider',
  'PageHeader',
  'Pagination',
  'Progress',
  'Select',
  'Skeleton',
  'Slideover',
  'Table',
  'Tabs',
] as const

interface CssTemplate {
  filename?: string
  getContents?: (data: never) => string | Promise<string>
}

interface NuxtUiOptionsLike {
  experimental?: { componentDetection?: boolean | string[] }
}

export interface NuxtUiSourcesHost {
  hook: (name: 'modules:done', handler: () => void) => unknown
  options: {
    build?: { templates?: CssTemplate[] }
    ui?: unknown
  }
}

/** Prepends one `@source` line per path to Nuxt UI's `ui.css` template. */
export function extendNuxtUiCssSources(templates: CssTemplate[], sources: readonly string[]): void {
  const template = templates.find(
    (candidate) => candidate.filename === NUXT_UI_CSS_TEMPLATE && candidate.getContents,
  )
  if (!template?.getContents || sources.length === 0) return
  const getContents = template.getContents
  const lines = sources
    .map((source) => `@source ${JSON.stringify(source.replaceAll('\\', '/'))};`)
    .join('\n')
  template.getContents = async (data: never) => `${lines}\n${await getContents(data)}`
}

/** Adds components to `componentDetection` when the app turned it on, without mutating its array. */
export function extendNuxtUiComponentDetection(ui: unknown, components: readonly string[]): void {
  const experimental = (ui as NuxtUiOptionsLike | undefined)?.experimental
  const detection = experimental?.componentDetection
  if (!experimental || !detection || components.length === 0) return
  const current = Array.isArray(detection) ? detection : []
  experimental.componentDetection = [...new Set([...current, ...components])]
}

export function registerNuxtUiSources(
  nuxt: NuxtUiSourcesHost,
  sources: readonly string[],
  components: readonly string[],
): void {
  // Nuxt UI adds its template and publishes `nuxt.options.ui` in its own
  // setup, which may run after this module's; both are read only once every
  // module is installed.
  nuxt.hook('modules:done', () => {
    extendNuxtUiCssSources(nuxt.options.build?.templates ?? [], sources)
    extendNuxtUiComponentDetection(nuxt.options.ui, components)
  })
}
