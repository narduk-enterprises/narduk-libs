<script setup lang="ts">
/**
 * NeKpiBand — a responsive grid of `NeKpiTile`s (components backlog item 15,
 * narduk-libs#262). It lays out; it does not style the tiles inside it — no
 * card, border or background of its own, just `display: grid` and a gap.
 *
 * `columns` picks the Tailwind `grid-cols-*` utility per breakpoint, e.g.
 * `{ base: 2, lg: 4 }`. The lookup below is a closed, fully written-out
 * table rather than a computed `` `grid-cols-${n}` `` string, because
 * Tailwind's build-time scanner only ships a utility whose class name it can
 * see literally in source — a name assembled at runtime is invisible to it
 * and never reaches the compiled CSS. Every class this component could ever
 * apply is therefore already a literal string somewhere in this file, for
 * every breakpoint from 1 to 6 columns (the widest KPI band in the plan's
 * three pilots is 4), so the one Tailwind actually needs is always among
 * them regardless of which prop value picks it at runtime.
 */
import { computed } from 'vue'

export type NeKpiBandBreakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl'
export type NeKpiBandColumnCount = 1 | 2 | 3 | 4 | 5 | 6

export interface NeKpiBandProps {
  /**
   * Columns per breakpoint. Only the breakpoints given are constrained; an
   * app's own responsive design fills in the rest from Tailwind's normal
   * cascade. Defaults to a single column, so an empty band still stacks
   * sensibly on its own.
   */
  columns?: Partial<Record<NeKpiBandBreakpoint, NeKpiBandColumnCount>>
}

const props = withDefaults(defineProps<NeKpiBandProps>(), {
  columns: () => ({ base: 1 }),
})

const BREAKPOINTS: readonly NeKpiBandBreakpoint[] = ['base', 'sm', 'md', 'lg', 'xl']

/** Literal so Tailwind's scanner sees every class it will ever need to emit. */
const GRID_COLUMN_CLASS: Readonly<
  Record<NeKpiBandBreakpoint, Record<NeKpiBandColumnCount, string>>
> = {
  base: {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
  },
  sm: {
    1: 'sm:grid-cols-1',
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-4',
    5: 'sm:grid-cols-5',
    6: 'sm:grid-cols-6',
  },
  md: {
    1: 'md:grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
    5: 'md:grid-cols-5',
    6: 'md:grid-cols-6',
  },
  lg: {
    1: 'lg:grid-cols-1',
    2: 'lg:grid-cols-2',
    3: 'lg:grid-cols-3',
    4: 'lg:grid-cols-4',
    5: 'lg:grid-cols-5',
    6: 'lg:grid-cols-6',
  },
  xl: {
    1: 'xl:grid-cols-1',
    2: 'xl:grid-cols-2',
    3: 'xl:grid-cols-3',
    4: 'xl:grid-cols-4',
    5: 'xl:grid-cols-5',
    6: 'xl:grid-cols-6',
  },
}

const gridClasses = computed(() =>
  BREAKPOINTS.map((breakpoint) => {
    const count = props.columns[breakpoint]
    return count ? GRID_COLUMN_CLASS[breakpoint][count] : undefined
  }).filter((value): value is string => Boolean(value)),
)
</script>

<template>
  <div data-testid="ne-kpi-band" class="ne-kpi-band grid gap-4" :class="gridClasses">
    <slot />
  </div>
</template>
