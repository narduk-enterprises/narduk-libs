/**
 * The Nuxt UI components narduk-core's own `runtime/app` files name, without
 * the `U` prefix: what Nuxt UI's `componentDetection` would find there if
 * core were a layer. It is not, and detection never scans `node_modules`, so
 * core adds these itself (narduk-libs#700). `error.vue` renders `UButton`; the
 * dashboard shell the `dashboard` layout wraps renders the `UDashboard*` set.
 *
 * `tests/nuxt-ui-sources.test.ts` rescans `runtime/app` with Nuxt UI's own
 * pattern and fails when this list drifts from the files.
 */
export const CORE_NUXT_UI_COMPONENTS = [
  'App',
  'Badge',
  'Breadcrumb',
  'Button',
  'Card',
  'DashboardGroup',
  'DashboardNavbar',
  'DashboardPanel',
  'DashboardSidebar',
  'DashboardSidebarCollapse',
  'DashboardToolbar',
  'Form',
  'FormField',
  'Icon',
  'Input',
  'Link',
  'Modal',
  'Popover',
  'Skeleton',
  'Tabs',
] as const
