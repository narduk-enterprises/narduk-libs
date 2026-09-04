<script setup lang="ts">
/**
 * A highly configurable, responsive layer application header.
 */
import type { RouteLocationRaw } from 'vue-router'

interface NavLink {
  href?: string
  icon?: string
  label: string
  to?: RouteLocationRaw
}

const _props = withDefaults(
  defineProps<{
    appName?: string
    logoText?: string
    navLinks?: NavLink[]
    showColorModeToggle?: boolean
  }>(),
  {
    appName: '',
    logoText: 'N4',
    navLinks: () => [],
    showColorModeToggle: true,
  },
)

const route = useRoute()
const { colorModeIcon, cycleColorMode } = useColorModeToggle()

const mobileMenuOpen = ref(false)

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function getNavLinkKey(link: NavLink) {
  const fromHref = link.href?.trim() ? link.href : undefined
  const target =
    fromHref ??
    (typeof link.to === 'string'
      ? link.to
      : link.to && typeof link.to === 'object'
        ? JSON.stringify(link.to)
        : '')

  return `${link.label}:${target}`
}

// Close mobile menu on route change.
// Strip the hash from fullPath so query-param navigations still close the menu
// while ignoring hash-only changes that can cause hydration mismatches.
watch(
  () => route.fullPath.replace(/#.*$/, ''),
  () => {
    mobileMenuOpen.value = false
  },
)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-restricted-html-elements -- layer scaffold: semantic landmark element -->
  <header class="sticky top-0 z-50 border-b border-default bg-default/80 backdrop-blur-xl">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <!-- Brand / Logo Area -->
      <slot name="logo">
        <ULink to="/" class="flex items-center gap-2.5 group shrink-0">
          <div
            class="size-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm"
          >
            {{ logoText }}
          </div>
          <span class="font-display font-semibold text-lg hidden sm:block">
            {{ appName }}
          </span>
        </ULink>
      </slot>

      <!-- Desktop nav -->
      <!-- eslint-disable-next-line vue/no-restricted-html-elements -- layer scaffold: semantic landmark element -->
      <nav class="hidden md:flex items-center gap-1" aria-label="Main navigation">
        <slot name="navigation">
          <template v-if="navLinks.length">
            <template v-for="link in navLinks" :key="getNavLinkKey(link)">
              <!-- Internal Link -->
              <ULink
                v-if="link.to"
                :to="link.to"
                class="px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
                :class="
                  route.path === link.to
                    ? 'text-primary bg-primary/10'
                    : 'text-muted hover:text-default hover:bg-elevated'
                "
              >
                <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; adjacent link text is the accessible name -->
                <UIcon v-if="link.icon" :name="link.icon" class="size-4" aria-hidden="true" />
                {{ link.label }}
              </ULink>

              <!-- eslint-disable-next-line narduk/prefer-ulink -- external link with target blank requires explicit rel -->
              <a
                v-else-if="link.href"
                :href="link.href"
                target="_blank"
                rel="noopener noreferrer"
                class="px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 text-muted hover:text-default hover:bg-elevated"
              >
                <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; adjacent link text is the accessible name -->
                <UIcon v-if="link.icon" :name="link.icon" class="size-4" aria-hidden="true" />
                {{ link.label }}
              </a>
            </template>
          </template>
        </slot>
      </nav>

      <!-- Actions (Color Mode, Mobile Menu, Custom Actions) -->
      <div class="flex items-center gap-1">
        <slot name="actions"></slot>

        <UButton
          v-if="showColorModeToggle"
          :icon="colorModeIcon"
          variant="ghost"
          color="neutral"
          aria-label="Toggle color mode"
          @click="cycleColorMode"
        />

        <!-- Mobile hamburger -->
        <UButton
          color="neutral"
          variant="ghost"
          class="md:hidden p-2 rounded-lg hover:bg-elevated"
          aria-label="Toggle navigation menu"
          :aria-expanded="mobileMenuOpen"
          @click="toggleMobileMenu"
        >
          <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; button aria-label names the action -->
          <UIcon :name="mobileMenuOpen ? 'i-lucide-x' : 'i-lucide-menu'" class="size-5" />
        </UButton>
      </div>
    </div>

    <!-- Mobile nav drawer -->
    <Transition name="slide-down">
      <!-- eslint-disable-next-line vue/no-restricted-html-elements -- layer scaffold: semantic landmark element -->
      <nav
        v-if="mobileMenuOpen"
        class="md:hidden border-t border-default bg-default/95 backdrop-blur-xl"
        aria-label="Mobile navigation"
      >
        <div class="max-w-7xl mx-auto px-4 py-3 space-y-1">
          <slot name="mobile-navigation">
            <template v-if="navLinks.length">
              <template v-for="link in navLinks" :key="getNavLinkKey(link)">
                <!-- Internal Link -->
                <ULink
                  v-if="link.to"
                  :to="link.to"
                  class="flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors"
                  :class="
                    route.path === link.to
                      ? 'text-primary bg-primary/10'
                      : 'text-muted hover:text-default hover:bg-elevated'
                  "
                >
                  <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; adjacent link text is the accessible name -->
                  <UIcon v-if="link.icon" :name="link.icon" class="size-4" aria-hidden="true" />
                  {{ link.label }}
                </ULink>

                <!-- eslint-disable-next-line narduk/prefer-ulink -- external link with target blank requires explicit rel -->
                <a
                  v-else-if="link.href"
                  :href="link.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors text-muted hover:text-default hover:bg-elevated"
                >
                  <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; adjacent link text is the accessible name -->
                  <UIcon v-if="link.icon" :name="link.icon" class="size-4" aria-hidden="true" />
                  {{ link.label }}
                </a>
              </template>
            </template>
          </slot>
        </div>
      </nav>
    </Transition>
  </header>
</template>

<style>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
