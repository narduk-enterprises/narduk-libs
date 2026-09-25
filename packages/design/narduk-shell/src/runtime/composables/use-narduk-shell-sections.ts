/**
 * `useNardukShellSections()` — the rail's sections as shared, SSR-safe state
 * (components backlog item 18, narduk-libs#265).
 *
 * ```ts
 * const sections = useNardukShellSections()
 * if (isAdmin.value) {
 *   sections.value.push({ id: 'admin', label: 'Admin', items: [{ label: 'Users', to: '/admin/users' }] })
 * }
 * ```
 *
 * Seeded once per request from `app.config.nardukShell.sections` — which the
 * module fills from the `nardukShell.sections` option in `nuxt.config.ts`,
 * and which the app's own `app/app.config.ts` can set or replace. After that
 * the state is the app's: `NeAppShell` renders whatever it holds, so pushing,
 * removing or editing a section re-renders the rail.
 *
 * ## Why `useState`
 *
 * It is Nuxt's per-request shared state. Every caller in one request gets the
 * same ref, so a mutation made in a page or a plugin reaches the shell; the
 * server serialises it into the payload, so the client hydrates the rail the
 * server drew — including a section added during SSR — instead of re-seeding
 * from config and dropping it. A module-scope `ref` would do neither: on the
 * server it would be shared by every request the process serves.
 *
 * ## Why the seed is a copy
 *
 * `app.config` is one object for the whole server process. Seeding the state
 * with it by reference would make `sections.value.push()` in one request edit
 * the config every later request seeds from. The seed is copied down to the
 * item objects, so the state can be mutated freely and the config never is.
 */
import type { Ref } from 'vue'

import { useAppConfig, useState } from '#imports'

import type {
  NeAppShellAppConfig,
  NeAppShellItem,
  NeAppShellSection,
} from '../components/ne-app-shell-types'

/** The `app.config` key the module writes and the runtime reads. */
export const NARDUK_SHELL_CONFIG_KEY = 'nardukShell'

/** The `useState` key. Namespaced so no app key can collide with it. */
export const NARDUK_SHELL_SECTIONS_STATE_KEY = 'narduk-shell:sections'

/** `app.config.nardukShell`, or `{}` when the app configured none. */
export function readShellAppConfig(appConfig: Record<string, unknown>): NeAppShellAppConfig {
  const value = appConfig[NARDUK_SHELL_CONFIG_KEY]
  return value && typeof value === 'object' ? (value as NeAppShellAppConfig) : {}
}

function copyItem(item: NeAppShellItem): NeAppShellItem {
  return { ...item }
}

/**
 * A copy of `sections` that shares no object with it, down to the items.
 * Written out rather than `structuredClone`d: the input may be a reactive
 * proxy (Nuxt's `app.config` is), which `structuredClone` refuses.
 */
export function copySections(sections: readonly NeAppShellSection[]): NeAppShellSection[] {
  return sections.map((section) => ({ ...section, items: section.items.map(copyItem) }))
}

export function useNardukShellSections(): Ref<NeAppShellSection[]> {
  return useState<NeAppShellSection[]>(NARDUK_SHELL_SECTIONS_STATE_KEY, () =>
    copySections(readShellAppConfig(useAppConfig()).sections ?? []),
  )
}
