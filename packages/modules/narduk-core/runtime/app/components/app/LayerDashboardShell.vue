<script setup lang="ts">
/**
 * The shared dashboard frame behind narduk-core's `dashboard` layout: a
 * collapsible `UDashboardSidebar` of `navItems`, a navbar with breadcrumbs and
 * status badges, and the account menu.
 *
 * @deprecated Use `NeAppShell` from `@narduk-enterprises/narduk-shell`
 * instead (components backlog item 18, narduk-libs#265). Deprecated
 * 2026-09-25 under decision D4 and removed in the next narduk-core major;
 * behaviour is unchanged until then. No runtime warning: narduk-core's own
 * `dashboard` layout renders it, so a warning would fire in apps that never
 * chose this component. The migration mapping is in this package's README
 * under "Deprecated components".
 */
import { readRuntimeConfigString } from '../../utils/readRuntimeConfigString'

interface DashboardNavItem {
  icon: string
  label: string
  requiresAdmin?: boolean
  testId?: string
  to: string
}

interface DashboardBadge {
  color?: 'error' | 'info' | 'primary' | 'secondary' | 'success' | 'warning' | 'neutral'
  label: string
  variant?: 'solid' | 'outline' | 'soft' | 'subtle'
}

interface DashboardSidebarSizing {
  collapsedSize?: number
  defaultSize?: number
  maxSize?: number
  minSize?: number
}

interface DashboardAppConfig {
  dashboard?: {
    navItems?: DashboardNavItem[]
  }
}

const props = withDefaults(
  defineProps<{
    appName?: string
    badgeLabel?: string
    description?: string
    navItems?: DashboardNavItem[]
    sidebarSizing?: DashboardSidebarSizing
    statusBadges?: DashboardBadge[]
  }>(),
  {
    appName: '',
    badgeLabel: 'Shared dashboard shell',
    description:
      'Persistent navigation, scoped work surfaces, and room for dense operational workflows.',
    navItems: (): DashboardNavItem[] => [
      { label: 'Overview', to: '/dashboard/', icon: 'i-lucide-layout-dashboard' },
    ],
    sidebarSizing: (): DashboardSidebarSizing => ({
      collapsedSize: 5.5,
      defaultSize: 18,
      minSize: 14,
      maxSize: 22,
    }),
    statusBadges: () => [],
  },
)

const route = useRoute()
const { description, navItems, sidebarSizing } = toRefs(props)
const appConfig = useAppConfig() as DashboardAppConfig
const { user } = useUserSession()

const isAdminSession = computed(() => {
  const sessionUser = user.value as { isAdmin?: boolean | null } | null
  return sessionUser?.isAdmin === true
})

const resolvedAppName = computed(() => {
  if (props.appName) return props.appName
  return readRuntimeConfigString(useRuntimeConfig().public.appName, 'Workspace')
})

function formatSegmentLabel(segment: string) {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const dashboardSegments = computed(() => {
  const segments = route.path.split('/').filter(Boolean)
  return segments[0] === 'dashboard' ? segments.slice(1) : segments
})

const dashboardNavItems = computed(() => {
  const seen = new Set<string>()
  const merged: DashboardNavItem[] = []

  for (const item of [...navItems.value, ...(appConfig.dashboard?.navItems ?? [])]) {
    if (item.requiresAdmin && !isAdminSession.value) continue
    if (seen.has(item.to)) continue
    seen.add(item.to)
    merged.push(item)
  }

  return merged
})

const activeNavItem = computed(() => {
  const matches = dashboardNavItems.value
    .filter((item) => isActive(item.to))
    .sort((left, right) => right.to.length - left.to.length)

  return matches[0] ?? null
})

const currentSection = computed(() => {
  if (activeNavItem.value) return activeNavItem.value.label
  if (dashboardSegments.value.length === 0) return 'Dashboard'

  if (dashboardSegments.value[0] === 'projects' && dashboardSegments.value.length > 1) {
    return 'Project Overview'
  }

  return formatSegmentLabel(dashboardSegments.value.at(-1)!)
})

const currentSectionIcon = computed(() => activeNavItem.value?.icon ?? 'i-lucide-layout-dashboard')

const scopeTrail = computed(() => {
  if (activeNavItem.value) {
    return ['Dashboard', activeNavItem.value.label]
  }

  const formatted = dashboardSegments.value.map((segment) => formatSegmentLabel(segment))
  return ['Dashboard', ...formatted]
})

const effectiveBadges = computed<DashboardBadge[]>(() => {
  if (props.statusBadges.length > 0) return props.statusBadges

  return [
    { label: resolvedAppName.value, color: 'primary', variant: 'subtle' },
    { label: currentSection.value, color: 'neutral', variant: 'soft' },
  ]
})

const resolvedSidebarSizing = computed(() => ({
  collapsedSize: sidebarSizing.value.collapsedSize ?? 5.5,
  defaultSize: sidebarSizing.value.defaultSize ?? 18,
  minSize: sidebarSizing.value.minSize ?? 14,
  maxSize: sidebarSizing.value.maxSize ?? 22,
}))

function isActive(path: string) {
  const normalized = path.replace(/\/+$/, '') // strip trailing slash

  // A "root" nav item is one whose path has exactly one non-empty segment
  // (e.g. /admin, /dashboard). These must be exact matches only, otherwise
  // every child route (/admin/leads, /admin/products …) would also activate
  // the parent Overview item.
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 1) {
    return route.path === normalized || route.path === `${normalized}/`
  }

  return route.path === normalized || route.path.startsWith(`${normalized}/`)
}

function navItemTestId(item: DashboardNavItem) {
  const base =
    [item.testId, item.to, item.label].find((v) => v != null && String(v).trim() !== '') ??
    item.label
  const normalized = base
    .trim()
    .toLowerCase()
    .replaceAll(/^\/+|\/+$/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return `dashboard-nav-${normalized || 'item'}`
}
</script>

<template>
  <UDashboardGroup class="min-h-screen bg-default text-default">
    <!-- eslint-disable narduk/no-unknown-component-prop -- UDashboardSidebar is from Nuxt UI Pro which is not fully covered by the rule -->
    <UDashboardSidebar
      data-testid="dashboard-sidebar"
      collapsible
      resizable
      :collapsed-size="resolvedSidebarSizing.collapsedSize"
      :default-size="resolvedSidebarSizing.defaultSize"
      :min-size="resolvedSidebarSizing.minSize"
      :max-size="resolvedSidebarSizing.maxSize"
      class="overflow-hidden border-r border-default bg-linear-to-b from-elevated via-elevated/85 to-default"
    >
      <!-- eslint-enable narduk/no-unknown-component-prop -->
      <template #header="{ collapsed }">
        <div
          data-testid="dashboard-sidebar-header"
          class="px-2 py-2"
          :class="
            collapsed
              ? 'flex flex-col items-center gap-2'
              : 'flex items-center gap-3 overflow-hidden'
          "
        >
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20"
          >
            <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; app title is sibling -->
            <UIcon name="i-lucide-shield-check" class="size-5" />
          </div>

          <div v-if="!collapsed" class="min-w-0 flex-1 overflow-hidden">
            <h1 class="truncate font-display text-lg font-semibold text-highlighted">
              {{ resolvedAppName }}
            </h1>
          </div>

          <UDashboardSidebarCollapse
            side="left"
            data-testid="dashboard-sidebar-collapse"
            class="hidden lg:inline-flex"
            :class="collapsed ? '' : 'ml-auto'"
          />
        </div>
      </template>

      <template #default="{ collapsed }">
        <div class="flex h-full flex-col gap-6 px-2 py-2">
          <div class="space-y-1">
            <UButton
              v-for="item in dashboardNavItems"
              :key="item.to"
              :to="item.to"
              :data-testid="navItemTestId(item)"
              :variant="isActive(item.to) ? 'soft' : 'ghost'"
              :color="isActive(item.to) ? 'primary' : 'neutral'"
              :square="collapsed"
              class="w-full"
              :class="collapsed ? 'justify-center px-0' : 'justify-start gap-3'"
            >
              <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; nav label is sibling -->
              <UIcon :name="item.icon" class="size-4 shrink-0" />
              <span v-if="!collapsed">{{ item.label }}</span>
            </UButton>
          </div>

          <slot name="sidebar-info" :collapsed="collapsed">
            <div
              v-if="!collapsed"
              class="mt-auto rounded-3xl border border-default bg-default/80 p-4 shadow-card"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-dimmed">Scope</p>
              <p class="mt-2 text-sm leading-6 text-default">
                {{ description }}
              </p>
            </div>
          </slot>
        </div>
      </template>

      <template #footer="{ collapsed }">
        <div class="px-2 pb-2 pt-1" :class="collapsed ? 'flex justify-center' : ''">
          <slot name="sidebar-footer" :collapsed="collapsed" :current-section="currentSection">
            <div
              class="border border-default bg-elevated/70"
              :class="
                collapsed
                  ? 'flex size-12 items-center justify-center rounded-2xl'
                  : 'rounded-3xl p-4'
              "
            >
              <div class="flex items-center gap-3">
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
                >
                  <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; section title is sibling -->
                  <UIcon name="i-lucide-layers-3" class="size-4" />
                </div>

                <div v-if="!collapsed" class="min-w-0">
                  <p class="text-xs uppercase tracking-[0.18em] text-dimmed">Current section</p>
                  <p class="mt-1 text-sm font-medium text-default">{{ currentSection }}</p>
                </div>
              </div>
            </div>
          </slot>
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel class="min-w-0 bg-linear-to-b from-primary/4 via-default to-default">
      <UDashboardNavbar
        data-testid="dashboard-navbar"
        :title="currentSection"
        :icon="currentSectionIcon"
        class="border-b border-default bg-default/90 backdrop-blur"
      >
        <template #right>
          <slot name="navbar-right">
            <LayerDashboardAccountMenu />
          </slot>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar class="border-b border-default bg-default/70">
        <template #left>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              v-for="badge in effectiveBadges"
              :key="badge.label"
              :color="badge.color ?? 'neutral'"
              :variant="badge.variant ?? 'soft'"
              class="rounded-full"
            >
              {{ badge.label }}
            </UBadge>
          </div>
        </template>

        <template #right>
          <div class="hidden flex-wrap items-center gap-2 text-xs text-muted md:flex">
            <template v-for="(segment, index) in scopeTrail" :key="`${segment}-${index}`">
              <span>{{ segment }}</span>
              <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; crumbs use adjacent text -->
              <UIcon
                v-if="index < scopeTrail.length - 1"
                name="i-lucide-chevron-right"
                class="size-3 text-dimmed"
              />
            </template>
          </div>
        </template>
      </UDashboardToolbar>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <slot />
        </div>
      </div>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
