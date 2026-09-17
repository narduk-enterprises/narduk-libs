// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import NeStatusBadge from '../src/runtime/components/NeStatusBadge.vue'

import type { NeStatusTone } from '../src/runtime/utils/status-map'

/**
 * A stand-in for Nuxt UI's `UBadge`. `NeStatusBadge.vue` writes a bare
 * `<UBadge>` tag rather than a static import -- this package type-checks and
 * tests standalone, with no live Nuxt app of its own to resolve `UBadge`'s
 * build-time-only `#build/ui/badge` alias (see the component's own header
 * comment) -- so these tests register this fake under the same global name,
 * the way a real Nuxt app registers the real thing. It exposes exactly the
 * props NeStatusBadge hands it, which is what every test here checks.
 */
const FakeUBadge = defineComponent({
  name: 'UBadge',
  props: ['color', 'variant', 'size', 'icon', 'ui'],
  setup(props, { attrs, slots }) {
    return () =>
      h(
        'span',
        {
          ...attrs,
          'data-color': props.color,
          'data-variant': props.variant,
          'data-size': props.size,
          'data-icon': props.icon,
          'data-ui-base': props.ui?.base,
        },
        slots.default?.(),
      )
  },
})

interface BadgeTestProps {
  tone: NeStatusTone
  label: string
  icon?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'solid' | 'outline' | 'soft' | 'subtle'
  truncate?: boolean
}

function mountBadge(props: BadgeTestProps) {
  return mount(NeStatusBadge, {
    props,
    global: { components: { UBadge: FakeUBadge } },
  })
}

describe('NeStatusBadge', () => {
  const toneColors: Array<[NeStatusTone, string]> = [
    ['ok', 'success'],
    ['warn', 'warning'],
    ['error', 'error'],
    ['info', 'info'],
    ['neutral', 'neutral'],
  ]

  for (const [tone, color] of toneColors) {
    it(`maps tone "${tone}" to the Nuxt UI colour "${color}"`, () => {
      const wrapper = mountBadge({ tone, label: 'Label' })
      expect(wrapper.attributes('data-color')).toBe(color)
      // Only `pending` carries a default variant/icon; every other tone
      // leaves both unset so UBadge falls back to its own defaults.
      expect(wrapper.attributes('data-variant')).toBeUndefined()
      expect(wrapper.attributes('data-icon')).toBeUndefined()
    })
  }

  it('maps "pending" to neutral with a subtle variant and a default leading icon', () => {
    const wrapper = mountBadge({ tone: 'pending', label: 'Waiting' })
    expect(wrapper.attributes('data-color')).toBe('neutral')
    expect(wrapper.attributes('data-variant')).toBe('subtle')
    expect(wrapper.attributes('data-icon')).toBe('i-lucide-loader-circle')
  })

  it('lets an explicit variant and icon override the pending default', () => {
    const wrapper = mountBadge({
      tone: 'pending',
      label: 'Waiting',
      variant: 'outline',
      icon: 'i-lucide-hourglass',
    })
    expect(wrapper.attributes('data-variant')).toBe('outline')
    expect(wrapper.attributes('data-icon')).toBe('i-lucide-hourglass')
  })

  it('lets an explicit variant and icon apply to a non-pending tone too', () => {
    const wrapper = mountBadge({
      tone: 'ok',
      label: 'Live',
      variant: 'soft',
      icon: 'i-lucide-check',
    })
    expect(wrapper.attributes('data-variant')).toBe('soft')
    expect(wrapper.attributes('data-icon')).toBe('i-lucide-check')
  })

  it('passes size through untouched', () => {
    const wrapper = mountBadge({ tone: 'ok', label: 'Live', size: 'lg' })
    expect(wrapper.attributes('data-size')).toBe('lg')
  })

  it('renders the visible label text', () => {
    const wrapper = mountBadge({ tone: 'ok', label: 'Operational' })
    expect(wrapper.text()).toBe('Operational')
  })

  it('never wraps the label mid-word by default: the label span is whitespace-nowrap, not truncate', () => {
    // operator-portal#156: `overflow-wrap: anywhere` split the single word
    // "unknown" into "unknow" / "n" across two independent components in one
    // evening, once a value column happened to be narrow enough.
    const wrapper = mountBadge({ tone: 'neutral', label: 'unknown' })
    const label = wrapper.get('[data-slot="label"]')
    expect(label.classes()).toContain('whitespace-nowrap')
    expect(label.classes()).not.toContain('truncate')
  })

  it('truncates with an ellipsis only when the truncate prop is explicitly set', () => {
    const wrapper = mountBadge({
      tone: 'neutral',
      label: 'A very long status label indeed',
      truncate: true,
    })
    const label = wrapper.get('[data-slot="label"]')
    expect(label.classes()).toContain('truncate')
    expect(label.classes()).not.toContain('whitespace-nowrap')
  })

  /*
   * Contrast on the tinted variants. Nuxt UI paints `--ui-<color>` -- shade
   * 500 -- on a 10% tint of the same colour, which axe measured on a live app
   * at 2.04:1 (success), 1.79:1 (warning), 3.30:1 (error) and 3.34:1 (info)
   * against the 4.5:1 small text needs. These assert the correction is applied
   * where it belongs and, just as importantly, NOT where it would break
   * something.
   */
  describe('tinted-variant contrast', () => {
    const tintedToneShades: Array<[NeStatusTone, string]> = [
      ['ok', 'success'],
      ['warn', 'warning'],
      ['error', 'error'],
      ['info', 'info'],
    ]

    for (const [tone, color] of tintedToneShades) {
      for (const variant of ['soft', 'subtle', 'outline'] as const) {
        it(`darkens "${tone}" ink on the ${variant} variant to shade 800`, () => {
          const wrapper = mountBadge({ tone, label: 'Label', variant })
          expect(wrapper.attributes('data-ui-base')).toBe(
            `text-[var(--ui-color-${color}-800)] dark:text-[var(--ui-${color})]`,
          )
        })
      }
    }

    it('reads the shade from the colour ALIAS, never a literal Tailwind ramp', () => {
      /*
       * `text-green-800` would be wrong for an app that aliases `success` to
       * another ramp -- it would paint that app's badge in a colour from a
       * palette it does not use.
       */
      const wrapper = mountBadge({ tone: 'ok', label: 'Live', variant: 'subtle' })
      const base = wrapper.attributes('data-ui-base') ?? ''
      expect(base).toContain('--ui-color-success-800')
      expect(base).not.toMatch(/text-(green|emerald|lime)-800/)
    })

    it('leaves dark mode exactly as Nuxt UI had it', () => {
      /*
       * A dark tint sits on a dark ground and wants a LIGHTER ink, which is
       * the opposite correction, and nothing has measured it. Restoring
       * `--ui-<color>` under `dark:` makes this change provably a no-op there.
       */
      const wrapper = mountBadge({ tone: 'error', label: 'Offline', variant: 'soft' })
      expect(wrapper.attributes('data-ui-base')).toContain('dark:text-[var(--ui-error)]')
    })

    it('leaves the SOLID variant alone — a dark ink there would be unreadable', () => {
      const wrapper = mountBadge({ tone: 'ok', label: 'Live', variant: 'solid' })
      expect(wrapper.attributes('data-ui-base')).toBeUndefined()
    })

    it('leaves an unset variant alone, because UBadge defaults it to solid', () => {
      const wrapper = mountBadge({ tone: 'ok', label: 'Live' })
      expect(wrapper.attributes('data-ui-base')).toBeUndefined()
    })

    it('leaves neutral alone: Nuxt UI already gives it a readable ink', () => {
      const wrapper = mountBadge({ tone: 'neutral', label: 'Unknown', variant: 'subtle' })
      expect(wrapper.attributes('data-ui-base')).toBeUndefined()
    })

    it('still corrects "pending", which defaults itself to a tinted variant', () => {
      /*
       * `pending` is neutral-coloured, so it takes no correction -- but the
       * path that decides has to see the DEFAULTED variant rather than the
       * unset prop, or a tone that defaults to a tint would be missed.
       */
      const wrapper = mountBadge({ tone: 'pending', label: 'Waiting' })
      expect(wrapper.attributes('data-variant')).toBe('subtle')
      expect(wrapper.attributes('data-ui-base')).toBeUndefined()
    })
  })

  it('carries the tone into a status role and accessible name, not colour alone', () => {
    const wrapper = mountBadge({ tone: 'error', label: 'Offline' })
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-label')).toBe('error: Offline')
  })

  it('recomputes the aria-label when the tone or label changes', async () => {
    const wrapper = mountBadge({ tone: 'ok', label: 'Operational' })
    expect(wrapper.attributes('aria-label')).toBe('ok: Operational')

    await wrapper.setProps({ tone: 'error', label: 'Degraded' })
    expect(wrapper.attributes('aria-label')).toBe('error: Degraded')
  })

  /*
   * The hex/rgb/hsl scan that used to open this test is gone, not dropped:
   * `test/styling-contract.test.ts` derives what it scans from
   * `src/registry.ts`, so it covers this component's script block — which is
   * where the map below lives — under the suite's one set of rules. What stays
   * here is the part that is about this component rather than about styling:
   * that each tone resolves to a Nuxt UI colour token by name.
   */
  it('maps every tone to a Nuxt UI colour token by name', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'src',
        'runtime',
        'components',
        'NeStatusBadge.vue',
      ),
      'utf8',
    )
    expect(source).toContain("ok: 'success'")
    expect(source).toContain("warn: 'warning'")
    expect(source).toContain("pending: 'neutral'")
  })
})
