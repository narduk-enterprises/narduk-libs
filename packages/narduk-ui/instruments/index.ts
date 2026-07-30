/**
 * Instruments — the Narduk Status Design System's measurement component family.
 *
 * Every component here encodes the system's first rule: a value appears against
 * a reference, or it does not appear as a chart. NsRangeBar requires a band and
 * NsLevelWell requires a median for that reason — the type system refuses the
 * bare progress bar this family exists to retire.
 *
 * The second rule is footprint: a missing measurement takes the hatch material
 * and an em-dash while occupying exactly the space a present one would, so a
 * directory never reflows as data arrives.
 */
export { default as NsFreshnessChip } from "./NsFreshnessChip.vue";
export { default as NsLevelWell } from "./NsLevelWell.vue";
export { default as NsRangeBar } from "./NsRangeBar.vue";
export { default as NsReadoutTile } from "./NsReadoutTile.vue";

export {
  MISSING,
  bandGeometry,
  bandPosition,
  deltaDirection,
  formatDelta,
  formatValue,
  positionPercent,
  type Band,
  type BandGeometry,
} from "../_core/measure";

export {
  SIGNALS,
  ageMinutes,
  classifySignal,
  formatAge,
  type SignalDescriptor,
  type SignalState,
} from "../_core/signal";
