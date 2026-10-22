/**
 * NePriceCell's public shape and its formatting helper. Separate from the SFC
 * so a page that wraps the cell can type its props, and so the text a cell
 * shows can be computed (a CSV column, a screen-reader label) without mounting
 * one.
 */
import { formatMoney, formatNumber, formatPercent } from '../../format'

/** What the number means: a plain figure, an amount in a currency, or a percentage. */
export type NePriceCellKind = 'money' | 'number' | 'percent'

/**
 * How the cell is tinted. Colour only, never width.
 *
 * - `none`: the surrounding ink.
 * - `sign`: green above zero, red below it, ink at zero. For a change, a
 *   P&L or a percentage move.
 * - `flash`: ink at rest; when `value` changes, up or down in the direction of
 *   the move for `flashMs`, then back. For a live price.
 */
export type NePriceCellTint = 'flash' | 'none' | 'sign'

export interface NePriceCellProps {
  /** The figure. `null`, `undefined` and `NaN` draw the unreported mark, never `0`. */
  value: number | null | undefined
  /** `money` needs `currency`; without it the figure is shown as a plain number. */
  kind?: NePriceCellKind
  /** ISO-4217 code for `kind="money"`. There is no house currency. */
  currency?: string
  /** Fraction digits, minimum and maximum. Default: the formatter's own. */
  digits?: number
  /** Always write the sign (`+1.20`, `-0.40`; zero has none), so colour is never the only cue. */
  signed?: boolean
  /** `percent` only: `fraction` reads `0.055` as 5.5%, `percent` reads `5.5`. Default `fraction`. */
  input?: 'fraction' | 'percent'
  /** BCP-47 tag. Default `en-US`. */
  locale?: string
  /** Minimum width in `ch` (digits are tabular, so one `ch` is one digit). Default 8. */
  chars?: number
  /** Where the figure sits in the reserved width. Default `end`, the number convention. */
  align?: 'end' | 'start'
  /** See {@link NePriceCellTint}. Default `none`. */
  tint?: NePriceCellTint
  /** How long a `flash` tint lasts, in milliseconds. Default 900. */
  flashMs?: number
  /** The unreported mark's accessible name, e.g. `Last price`. */
  label?: string
}

/** The default reserved width, in `ch`: `$1,234.56` fits. */
export const NE_PRICE_CELL_CHARS = 8

/** The default length of a `flash` tint, in milliseconds. */
export const NE_PRICE_CELL_FLASH_MS = 900

/**
 * The text a cell with these props shows; `undefined` when there is no figure
 * (the cell draws the unreported mark instead).
 *
 * ```ts
 * priceCellText({ value: 1234.5, kind: 'money', currency: 'USD', digits: 2 }) // '$1,234.50'
 * priceCellText({ value: 0.0123, kind: 'percent', signed: true })             // '+1.2%'
 * ```
 */
export function priceCellText(
  props: Pick<
    NePriceCellProps,
    'currency' | 'digits' | 'input' | 'kind' | 'locale' | 'signed' | 'value'
  >,
): string | undefined {
  const { value } = props
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const shared = {
    locale: props.locale,
    digits: props.digits,
    signDisplay: props.signed ? ('exceptZero' as const) : undefined,
  }
  if (props.kind === 'money' && props.currency) {
    return formatMoney(value, { ...shared, currency: props.currency })
  }
  if (props.kind === 'percent') return formatPercent(value, { ...shared, input: props.input })
  return formatNumber(value, shared)
}
