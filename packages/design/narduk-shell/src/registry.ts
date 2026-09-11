/**
 * The static component registry.
 *
 * Every `Ne*` component the module registers is named here, once, by hand. The
 * module walks this array and calls `addComponent` per entry — it never calls
 * `addComponentsDir`. That is the whole point of the file: a directory scan
 * silently loses to an app-local `app/components/NeStatePanel.vue` of the same
 * name, while an explicit registration collides loudly, so a shadowing app
 * finds out at build time instead of shipping two different `NeStatePanel`s.
 *
 * Item 1 of the components backlog (narduk-libs#248) shipped the home; each
 * later item appends its own entry alongside its component, README section
 * and tests. Do not scan a directory — only this list is registered.
 */

export interface NeComponentRegistration {
  /**
   * The global component name an app writes in a template, e.g. `NeStatePanel`.
   * Registrations are `Ne`-prefixed by the suite's standing convention
   * (company-hq D-WEBFOUND-2, `Ne*` provisional under Q7's parked renames).
   */
  name: string
  /**
   * The component's single-file component, as a specifier resolved against
   * `src/module.ts` by the module's own `createResolver`. Keep it relative so
   * the same entry works from the workspace checkout and from the published
   * tarball.
   */
  filePath: string
}

/**
 * Registered in array order. Filled in by each component backlog item.
 */
export const NE_SHELL_COMPONENTS: readonly NeComponentRegistration[] = [
  // Item 9 (narduk-libs#256): NePageHeader + NeSectionHeader.
  { name: 'NePageHeader', filePath: './runtime/components/NePageHeader.vue' },
  { name: 'NeSectionHeader', filePath: './runtime/components/NeSectionHeader.vue' },
  // Item 8 (narduk-libs#255): NeStatusBadge.
  { name: 'NeStatusBadge', filePath: './runtime/components/NeStatusBadge.vue' },
  // Item 16 (narduk-libs#263): NeConfirmDialog.
  { name: 'NeConfirmDialog', filePath: './runtime/components/NeConfirmDialog.vue' },
  // Item 7 (narduk-libs#254): NeStatePanel.
  { name: 'NeStatePanel', filePath: './runtime/components/NeStatePanel.vue' },
  // Item 19 (narduk-libs#266): NeForm, NeFormSection, NeSettingsPage.
  { name: 'NeForm', filePath: './runtime/components/NeForm.vue' },
  { name: 'NeFormSection', filePath: './runtime/components/NeFormSection.vue' },
  { name: 'NeSettingsPage', filePath: './runtime/components/NeSettingsPage.vue' },
]
