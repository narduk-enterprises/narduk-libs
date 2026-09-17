/**
 * The estate's four signal states, shared by all five status applications and
 * never restyled per app.
 *
 * These are deliberately defined by the source's own publishing interval rather
 * than by absolute ages. A buoy publishing every ten minutes and a reservoir
 * publishing daily are both "Live" when inside their own cadence, which is the
 * only comparison that means anything across five different products.
 */
export type SignalState = "live" | "aging" | "stale" | "void";

export interface SignalDescriptor {
  readonly state: SignalState;
  /** Short uppercase label for the chip. */
  readonly label: string;
  /** What the state means, for tooltips and accessible descriptions. */
  readonly meaning: string;
}

export const SIGNALS: Readonly<Record<SignalState, SignalDescriptor>> = Object.freeze({
  live: {
    state: "live",
    label: "Live",
    meaning: "Observation inside the source's own publishing interval.",
  },
  aging: {
    state: "aging",
    label: "Aging",
    meaning: "Past the publishing interval but inside three times it. Still shown, flagged.",
  },
  stale: {
    state: "stale",
    label: "Stale",
    meaning: "Beyond three times the publishing interval. Value shown with its age, never hidden.",
  },
  void: {
    state: "void",
    label: "No data",
    meaning: "Nothing published. Hatched, em-dash, reason line.",
  },
});

/**
 * Classify an observation against the interval its own source publishes on.
 *
 * @param observedAt   when the measurement was taken, or null if nothing published
 * @param intervalMinutes the source's own publishing interval
 * @param now          injectable for deterministic tests. The default reads
 *                     the ambient clock and is **not** SSR-safe — Vue
 *                     hydration fails when the server and the browser
 *                     disagree near a threshold. SSR and first-paint callers
 *                     must pass `now`. `NsFreshnessChip` does not use this
 *                     default: it requires `now` or waits until `onMounted`.
 *
 * Returns "void" for a missing or unparseable timestamp — never "live". A
 * measurement we cannot date is one we cannot vouch for, and defaulting to
 * fresh is how a stalled producer renders green for three days.
 */
export function classifySignal(
  observedAt: Date | string | null | undefined,
  intervalMinutes: number,
  now: Date = new Date(),
): SignalState {
  if (observedAt == null) return "void";
  if (!(intervalMinutes > 0)) return "void";

  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  const time = observed.getTime();
  if (!Number.isFinite(time)) return "void";

  const ageMinutes = (now.getTime() - time) / 60_000;
  // A timestamp from the future is not fresher than now; it is untrustworthy.
  if (ageMinutes < -intervalMinutes) return "void";

  if (ageMinutes <= intervalMinutes) return "live";
  if (ageMinutes <= intervalMinutes * 3) return "aging";
  return "stale";
}

/** Whole minutes since an observation, or null when it cannot be dated.
 *  The default `now` reads the ambient clock; pass an instant for SSR. */
export function ageMinutes(
  observedAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (observedAt == null) return null;
  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  const time = observed.getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / 60_000);
}

/**
 * Compact human age for the mono metadata line: "4 min", "3 h", "2 d".
 * Returns an em-dash for an undateable observation so the caller never has to
 * special-case a null into layout. The default `now` reads the ambient clock
 * and will fail hydration; pass an instant on the server.
 */
export function formatAge(
  observedAt: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const minutes = ageMinutes(observedAt, now);
  if (minutes == null) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}
