/**
 * The Nuxt UI components that other first-party Nuxt *modules* render, without
 * the `U` prefix, keyed by the module's `meta.name` (narduk-libs#1369).
 *
 * narduk-core turns `ui.experimental.componentDetection` on by default. Nuxt UI
 * scans only the app and its Nuxt layers for the `U*` components a page
 * renders, and never `node_modules`, so a component that only a module renders
 * (narduk-seo's network footer, narduk-analytics' admin panels) would lose its
 * theme. The module is not a layer, so core names those components on its
 * behalf whenever the module is installed. A package that registers its own
 * list through `registerNuxtUiSources` (narduk-auth, narduk-shell) needs no
 * entry here; the lists merge.
 *
 * `tests/performance-defaults.test.ts` rescans each package's files with Nuxt
 * UI's own pattern and fails when a list drifts.
 */
export const FIRST_PARTY_NUXT_UI_COMPONENTS: Readonly<Record<string, readonly string[]>> = {
  '@narduk-enterprises/narduk-ai': [
    'Button',
    'Card',
    'FormField',
    'Icon',
    'SelectMenu',
    'Textarea',
  ],
  '@narduk-enterprises/narduk-analytics': [
    'Button',
    'Card',
    'FormField',
    'Input',
    'SelectMenu',
    'Table',
  ],
  '@narduk-enterprises/narduk-seo': [
    'Alert',
    'Badge',
    'Button',
    'Card',
    'Container',
    'FormField',
    'Icon',
    'Input',
    'Link',
    'Page',
    'PageBody',
    'PageCard',
    'PageGrid',
    'PageHeader',
    'SelectMenu',
    'Textarea',
    'Tooltip',
  ],
}

interface InstalledModule {
  meta?: { name?: unknown }
}

/** The components the installed first-party modules render, de-duplicated. */
export function firstPartyNuxtUiComponents(
  installedModules: readonly InstalledModule[] | undefined,
): string[] {
  const installed = new Set(
    (installedModules ?? [])
      .map((module) => module.meta?.name)
      .filter((n) => typeof n === 'string'),
  )
  return [
    ...new Set(
      Object.entries(FIRST_PARTY_NUXT_UI_COMPONENTS)
        .filter(([name]) => installed.has(name))
        .flatMap(([, components]) => components),
    ),
  ]
}
