/*
 * Vitest setup for every narduk-shell unit test (narduk-libs#1403).
 *
 * 1. A `[Vue warn]` fails the test that caused it. Vue renders an unresolved
 *    component as an unknown element and an un-provided `inject()` as
 *    `undefined`, so without this a test asserts against markup an app never
 *    ships and stays green.
 * 2. Every `mount()` gets what a Nuxt page gives its components: a memory
 *    router (the real `UButton` / `ULink` inject the route) and a rendering
 *    `NuxtLink`. `fallback` installs them only when the test did not bring its
 *    own router or `NuxtLink`. `createSSRApp` has no global config, so an SSR
 *    test calls `.use(createVueTestEnv())` itself.
 *
 * The allowance list is empty on purpose. A warning that has to stay needs a
 * `reason`, and the list may only shrink.
 */
import { config } from '@vue/test-utils'
import { createVueTestEnv } from '@narduk-enterprises/narduk-testkit/vue-test-env'
import { installVueWarnGuard } from '@narduk-enterprises/narduk-testkit/vue-warn-guard'
import { beforeEach } from 'vitest'

installVueWarnGuard()

beforeEach(() => {
  config.global.plugins = [createVueTestEnv({ fallback: true })]
})
