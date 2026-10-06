/**
 * Value formatting and scale mathematics shared by every instrument.
 *
 * The single rule these encode: a measurement that is missing must look missing
 * and must occupy exactly the same space as a present one. Every formatter here
 * returns a renderable string for null rather than throwing or returning empty,
 * so a directory does not reflow as data arrives.
 */

/** The em-dash every missing measurement renders as. */
export const MISSING = "—";

/**
 * A number as text with thousands grouped. Fixed to en-US rather than the
 * reader's locale: the server and the first client render must print the same
 * string or the tile hydrates with a mismatch, and a mono tabular readout reads
 * the same everywhere. `grouping: false` is the plain fixed-decimals text.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();

function formatNumber(value: number, decimals: number, grouping: boolean): string {
  const key = `${decimals}:${grouping}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/**
 * Format a measured number for a mono tabular readout.
 *
 * Thousands are grouped ("1,055,144"); pass `grouping: false` for a value where
 * grouping adds noise, such as a four-digit year-like number.
 *
 * Returns MISSING for null/undefined/NaN — deliberately, rather than zero.
 * Zero-filling a gap is the specific failure this design system exists to stop.
 */
export function formatValue(
  value: number | null | undefined,
  options: { decimals?: number; grouping?: boolean; unit?: string } = {},
): string {
  if (value == null || !Number.isFinite(value)) return MISSING;
  const { decimals = 1, grouping = true, unit } = options;
  const text = formatNumber(value, decimals, grouping);
  return unit ? `${text} ${unit}` : text;
}

/**
 * Format a signed change for a delta line: "+0.42", "−1.10".
 * Uses U+2212 MINUS SIGN, not a hyphen, so digits align in a tabular column.
 * Large magnitudes are grouped like `formatValue`.
 */
export function formatDelta(
  value: number | null | undefined,
  options: { decimals?: number; grouping?: boolean; unit?: string } = {},
): string {
  if (value == null || !Number.isFinite(value)) return MISSING;
  const { decimals = 2, grouping = true, unit } = options;
  const magnitude = formatNumber(Math.abs(value), decimals, grouping);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return unit ? `${sign}${magnitude} ${unit}` : `${sign}${magnitude}`;
}

/** Direction of a change, for choosing a signal colour. Null when undateable. */
export function deltaDirection(value: number | null | undefined): "up" | "down" | null {
  if (value == null || !Number.isFinite(value) || value === 0) return null;
  return value > 0 ? "up" : "down";
}

/**
 * Position a value on a domain as a 0-100 percentage, clamped.
 *
 * Clamping matters: a reservoir above its conservation pool or a gauge above
 * major flood stage must pin to the end of its track rather than render off the
 * component and out of the card.
 */
export function positionPercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max <= min) return 0;
  const ratio = (value - min) / (max - min);
  const percent = Math.min(100, Math.max(0, ratio * 100));
  // Round to 4 decimals. Float division yields values like 55.00000000000001,
  // which are sub-nanometre on any real container but leak into the DOM as
  // noisy inline styles and make geometry assertions brittle.
  return Math.round(percent * 1e4) / 1e4;
}

/** A reference band — the p25-p75 normal, a conservation pool, a flood range. */
export interface Band {
  readonly low: number;
  readonly high: number;
  /** Optional label, e.g. "Normal for July" or "Action stage". */
  readonly label?: string;
}

export interface BandGeometry {
  readonly leftPercent: number;
  readonly widthPercent: number;
}

/** Place a band on the same domain as its value, for CSS left/width. */
export function bandGeometry(band: Band, min: number, max: number): BandGeometry {
  const left = positionPercent(band.low, min, max);
  const right = positionPercent(band.high, min, max);
  return { leftPercent: left, widthPercent: Math.max(0, right - left) };
}

/**
 * Whether a value sits below, inside, or above its reference band.
 * This is what "against normal" means in the directory, and it is computed once
 * here rather than re-derived per app.
 */
export function bandPosition(
  value: number | null | undefined,
  band: Band | null | undefined,
): "below" | "inside" | "above" | null {
  if (value == null || !Number.isFinite(value) || band == null) return null;
  if (value < band.low) return "below";
  if (value > band.high) return "above";
  return "inside";
}
