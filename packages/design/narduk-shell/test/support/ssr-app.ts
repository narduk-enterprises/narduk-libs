/*
 * `createSSRApp` with what a Nuxt page gives its components (narduk-libs#1403):
 * a memory router, so the real `UButton` / `ULink` can inject the route, and a
 * rendering `NuxtLink`. `createSSRApp` has no global config the way
 * `@vue/test-utils`' `mount` does, so the SSR proofs go through this instead.
 */
import { createVueTestEnv } from '@narduk-enterprises/narduk-testkit/vue-test-env'
import { createSSRApp } from 'vue'

export function createSSRAppWithEnv(...args: Parameters<typeof createSSRApp>) {
  return createSSRApp(...args).use(createVueTestEnv())
}
