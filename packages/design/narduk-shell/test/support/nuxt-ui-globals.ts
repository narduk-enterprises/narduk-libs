/*
 * The real Nuxt UI primitives the suite's SFCs address by global tag
 * (`<UCard>`, `<UBadge>`, `<UEmpty>`, `<USkeleton>`, `<UAlert>`), registered the
 * way Nuxt registers them (narduk-libs#1403).
 *
 * A server-render proof that leaves these unresolved renders each as an unknown
 * element and still passes, so a card whose inner Nuxt UI parts draw nothing
 * stays green. `@nuxt/ui/vite` in `vitest.config.ts` supplies the `#build/ui/*`
 * virtuals the sources import, which is what makes the real files importable
 * here; `test/nuxt-ui-stubs.ts` remains for tests that assert on what a wrapper
 * passes a primitive.
 */
import UAlert from '@nuxt/ui/components/Alert.vue'
import UBadge from '@nuxt/ui/components/Badge.vue'
import UCard from '@nuxt/ui/components/Card.vue'
import UEmpty from '@nuxt/ui/components/Empty.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'

import type { Component } from 'vue'

export const nuxtUiGlobals: Record<string, Component> = {
  UAlert,
  UBadge,
  UCard,
  UEmpty,
  USkeleton,
}
