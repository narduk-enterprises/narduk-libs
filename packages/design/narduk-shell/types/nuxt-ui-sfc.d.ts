/**
 * Type-only stand-in for `@nuxt/ui/components/*.vue` during `vue-tsc`.
 *
 * The real Nuxt UI SFCs import `#imports` and `#build/ui/*`, which exist only
 * inside a running Nuxt build. tsconfig paths send those specifiers here so
 * typecheck does not load them. Runtime still resolves the real files (Vite
 * does not honour these paths); tests mock the same specifiers.
 */
import type { DefineComponent } from 'vue'

declare const component: DefineComponent<Record<string, unknown>>
export default component
