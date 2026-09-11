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
 * Item 1 of the components backlog (narduk-libs#248) ships the home, not the
 * furniture: the registry is deliberately empty and each later backlog item
 * adds its own entry alongside its component, README section and tests.
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
 * Registered in array order. Filled in by each later backlog item alongside
 * its component, README section and tests.
 */
export const NE_SHELL_COMPONENTS: readonly NeComponentRegistration[] = [
  { name: 'NeStatusBadge', filePath: './runtime/components/NeStatusBadge.vue' },
]
