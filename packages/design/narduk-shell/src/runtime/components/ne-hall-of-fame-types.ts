import type { NeMarketingLink } from './ne-marketing-types'

/** PACC·TRAC's one-shot arrival; a new key remounts the slot's content. */
export interface NeSettleProps {
  motionKey?: string | number
  disabled?: boolean
}

export interface NeTimelinePeriod {
  /** Stable, unique identity; order is the caller's chronological order. */
  id: string
  label: string
  /** A finite, nonnegative quantity on the same scale as every other period. */
  value: number | null
  /** Caller-formatted figure, including units. Missing data ignores this label. */
  valueLabel?: string
  partial?: boolean
}

export interface NeTimelineHeroProps {
  eyebrow?: string
  subject: string
  verb: string
  /** The caller's formatted headline figure; null means not reported. */
  value: string | null
  suffix?: string
  description?: string
  periods: NeTimelinePeriod[]
  /** Controlled selection: the caller also updates the headline's own facts. */
  modelValue?: string
  timelineLabel?: string
}

export interface NeStatementMarker {
  /** A truthful caller-owned status, never inferred from a timer. */
  state: 'current' | 'stale' | 'unknown'
  label: string
  /** For example, a source timestamp or a program's time range. */
  detail?: string
}

export interface NeStatementHeroProps {
  eyebrow?: string
  title: string
  description?: string
  marker: NeStatementMarker
  links?: NeMarketingLink[]
}
