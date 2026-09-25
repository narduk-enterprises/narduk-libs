/**
 * The marketing sections' contracts: `NeHero`, `NeFeatureGrid`, `NeCta` and
 * `NeMarketingFooter` (components backlog item 21, narduk-libs#268).
 *
 * Each section is a thin themed wrapper over one Nuxt UI 4 primitive —
 * `UPageHero`, `UPageGrid` + `UPageFeature`, `UPageCTA` and `UFooter` — so
 * every prop below is that primitive's own prop, under its own name, with its
 * own default. Read against `@nuxt/ui` 4.11.1's
 * `dist/runtime/components/{PageHero,PageGrid,PageFeature,PageCTA,Footer}.vue`.
 * Nothing here is new behaviour; the wrappers add the NE token classes and
 * nothing else.
 *
 * Kept in a plain module for the same reason as `ne-pager-types.ts`: the
 * package root re-exports these as type-only exports, and a plain `.ts` file
 * is what a non-Vue-aware tool can read a named interface out of.
 *
 * The literal unions (`orientation`, `variant`) are restated rather than read
 * from Nuxt UI's `PageHero['variants']`: those index types come from the
 * build-time `#build/ui/*` virtual modules, which neither this package's
 * typecheck nor the Vue SFC compiler's props inference can resolve.
 */
import type { SlotClass } from '@nuxt/ui'
import type { ButtonProps } from '@nuxt/ui/components/Button.vue'
import type { PageFeatureProps } from '@nuxt/ui/components/PageFeature.vue'

/** Layout of a hero or call to action: text above the default slot, or beside it. */
export type NeMarketingOrientation = 'horizontal' | 'vertical'

/** One call-to-action button: exactly `UButton`'s props (`label`, `to`, `color`, `icon` …). */
export type NeMarketingLink = ButtonProps

/**
 * Per-slot class overrides, exactly as Nuxt UI's own `ui` prop takes them:
 * classes to merge, or a replacer function (`defaults => '…'`). Merged classes
 * land AFTER the suite's token class for the same slot, so they win a
 * conflict (Nuxt UI runs both through tailwind-merge); a replacer replaces the
 * suite's class along with Nuxt UI's.
 */
export type NeSlotClasses<TSlot extends string> = Partial<Record<TSlot, SlotClass>>

export type NeHeroSlot =
  | 'root'
  | 'container'
  | 'wrapper'
  | 'header'
  | 'headline'
  | 'title'
  | 'description'
  | 'body'
  | 'footer'
  | 'links'

/** `UPageHero`'s props, unchanged. */
export interface NeHeroProps {
  /** The root element. Default `'div'` (Nuxt UI's). */
  as?: string
  /** Small label above the title, painted in `--ne-accent`. */
  headline?: string
  /** The page's one `<h1>`. `UPageHero` always renders the title as `h1`. */
  title?: string
  /** Supporting copy under the title. */
  description?: string
  /** Buttons under the description, rendered by `UPageHero` at `size="xl"`. */
  links?: NeMarketingLink[]
  /** Default `'vertical'` (centred). `'horizontal'` puts the default slot beside the text. */
  orientation?: NeMarketingOrientation
  /** Put the default slot before the text instead of after it. */
  reverse?: boolean
  ui?: NeSlotClasses<NeHeroSlot>
}

/**
 * One feature tile: exactly `UPageFeature`'s props (`title`, `description`,
 * `icon`, `orientation`, `to`, `target`, `ui` …).
 */
export type NeFeature = PageFeatureProps

/** `UPageGrid`'s props, plus the feature list `UPageSection` also takes. */
export interface NeFeatureGridProps {
  /**
   * The grid element. Defaults to `'ul'` when `features` renders the tiles
   * (each tile is then an `li`, the list shape `UPageSection` renders), and
   * to `'div'` when the default slot supplies the content instead.
   */
  as?: string
  /** The tiles, each rendered as one `UPageFeature`. The default slot replaces them. */
  features?: NeFeature[]
  /** `UPageGrid`'s own `ui` — it has one slot, `base`. */
  ui?: NeSlotClasses<'base'>
}

export type NeCtaSlot =
  | 'root'
  | 'container'
  | 'wrapper'
  | 'header'
  | 'title'
  | 'description'
  | 'body'
  | 'footer'
  | 'links'

/** `UPageCTA`'s variants, unchanged. Default `'outline'` (Nuxt UI's). */
export type NeCtaVariant = 'solid' | 'outline' | 'soft' | 'subtle' | 'naked'

/** `UPageCTA`'s props, unchanged. */
export interface NeCtaProps {
  /** The root element. Default `'div'` (Nuxt UI's). */
  as?: string
  /** Rendered by `UPageCTA` as an `<h2>`. */
  title?: string
  description?: string
  /** Buttons under the description, rendered by `UPageCTA` at `size="lg"`. */
  links?: NeMarketingLink[]
  /** Default `'vertical'` (centred). */
  orientation?: NeMarketingOrientation
  /** Put the default slot before the text instead of after it. */
  reverse?: boolean
  variant?: NeCtaVariant
  ui?: NeSlotClasses<NeCtaSlot>
}

export type NeMarketingFooterSlot =
  'root' | 'top' | 'bottom' | 'container' | 'left' | 'center' | 'right'

/** `UFooter`'s props, unchanged. */
export interface NeMarketingFooterProps {
  /** The root element. Default `'footer'` (Nuxt UI's), which is the `contentinfo` landmark. */
  as?: string
  ui?: NeSlotClasses<NeMarketingFooterSlot>
}
