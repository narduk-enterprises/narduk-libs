import type { Component } from 'vue'

/*
 * Package-owned design cards and the Explorer's interactive wrappers, loaded on
 * demand: a page pulls in only the demo it shows. The card path is relative on
 * purpose (the same reasoning as design-system-build/app/app.vue): narduk-shell's
 * published `exports` stay what they are, and the workspace:* devDependency
 * states the build-time relationship.
 */
const cards = import.meta.glob<{ default: Component }>(
  '../../../narduk-shell/src/design-cards/*.card.vue',
)
const interactive = import.meta.glob<{ default: Component }>('../examples/*.vue')

function byBasename(
  modules: Record<string, () => Promise<{ default: Component }>>,
  basename: string,
): Component | null {
  const entry = Object.entries(modules).find(([path]) => path.endsWith(`/${basename}`))
  return entry ? defineAsyncComponent(() => entry[1]().then((module) => module.default)) : null
}

export function cardComponent(card: string): Component | null {
  return byBasename(cards, `${card}.card.vue`)
}

export function interactiveComponent(id: string): Component | null {
  return byBasename(interactive, `${id}.vue`)
}
