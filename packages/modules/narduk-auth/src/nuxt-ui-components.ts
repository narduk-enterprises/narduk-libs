/**
 * The Nuxt UI components narduk-auth's `app/` files name, without the `U`
 * prefix: what Nuxt UI's `componentDetection` would find there if this package
 * were a layer. It is not, and detection never scans `node_modules`, so the
 * module adds these itself (narduk-libs#700). `AuthExchangePanel`, which
 * `/auth/callback` and `/auth/confirm` render, needs `UAlert` and `UCard`.
 *
 * `tests/nuxt-ui-sources.test.ts` rescans `app/` with Nuxt UI's own pattern
 * and fails when this list drifts from the files.
 */
export const AUTH_NUXT_UI_COMPONENTS = [
  'Alert',
  'Avatar',
  'Badge',
  'Button',
  'Card',
  'Chip',
  'Form',
  'FormField',
  'Icon',
  'Input',
  'Link',
  'Page',
  'PageHero',
  'PageSection',
  'Popover',
  'SelectMenu',
  'Textarea',
] as const
