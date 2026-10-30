/**
 * The estate's four signal states. The states themselves are shared by every
 * status application; their colours are shared defaults an app's own design
 * may restyle (apps are designed independently, Logan 2026-09-19). What must
 * not drift is the meaning below, because that is what makes the states
 * comparable across products at all.
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

/** A zone-less date-time string is UTC, not the viewer's local time. */
function toDate(observedAt: Date | string): Date {
  if (observedAt instanceof Date) return observedAt;
  const zoneless = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(observedAt);
  return new Date(zoneless ? `${observedAt}Z` : observedAt);
}

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

  const observed = toDate(observedAt);
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
  const observed = toDate(observedAt);
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

/**
 * Absolute age limits for {@link classifySignalByAge}, in minutes. Each is an
 * exclusive upper bound: an observation is Live while its age is *under*
 * `live`, Aging while under `aging`, and Stale after that. This differs from
 * {@link classifySignal}, whose interval bound is inclusive; a product whose
 * rule reads "90 minutes or less" passes `live: 90` and accepts that exactly
 * 90:00 is Aging, or rounds ages to whole minutes and passes 91. With `stale` set,
 * an observation at or past it reads "void" — too old to vouch for.
 */
export interface SignalAgeLimits {
  readonly live: number;
  readonly aging: number;
  readonly stale?: number;
  /**
   * How far in the future a timestamp may be and still count as just
   * observed (clock skew between producer and reader). Default 5 minutes;
   * anything further ahead reads "void".
   */
  readonly futureToleranceMinutes?: number;
  /**
   * Make every limit an inclusive upper bound: Live through exactly `live`
   * minutes, Aging through exactly `aging`, and "void" only once the age is
   * past `stale`. For a product whose rule reads "60 minutes or less", where
   * a whole-minute age of 60 must still be Live. Default `false`, the
   * exclusive bounds described above.
   */
  readonly inclusive?: boolean;
}

/**
 * Classify an observation against fixed age limits instead of the source's
 * publishing interval. Use it where a product publishes its own definition of
 * Live — "under 6 h" for a reservoir, "under 15 min" for a border wait — which
 * {@link classifySignal}'s 1×/3× interval rule cannot express. lakestat-us,
 * buoys, borderwaitstat-us, gonogo and riverstatus each carried a copy of this
 * ladder with their own thresholds.
 *
 * `now` is required: there is no ambient-clock default, so a server render and
 * the browser classify against the same instant. A missing, unparseable or
 * too-far-future timestamp reads "void", never "live".
 */
export function classifySignalByAge(
  observedAt: Date | string | number | null | undefined,
  limits: SignalAgeLimits,
  now: Date | number,
): SignalState {
  if (observedAt == null) return "void";
  const tolerance = limits.futureToleranceMinutes ?? 5;
  if (!(limits.live > 0) || !(limits.aging >= limits.live)) return "void";
  if (limits.stale !== undefined && !(limits.stale >= limits.aging)) return "void";
  if (!(Number.isFinite(tolerance) && tolerance >= 0)) return "void";
  const time = typeof observedAt === "number" ? observedAt : toDate(observedAt).getTime();
  const nowTime = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(time) || !Number.isFinite(nowTime)) return "void";

  const age = (nowTime - time) / 60_000;
  if (age < -tolerance) return "void";
  const within = limits.inclusive
    ? (limit: number) => age <= limit
    : (limit: number) => age < limit;
  if (within(limits.live)) return "live";
  if (within(limits.aging)) return "aging";
  if (limits.stale !== undefined && !within(limits.stale)) return "void";
  return "stale";
}

const SEVERITY: Readonly<Record<SignalState, number>> = { live: 0, aging: 1, stale: 2, void: -1 };

/**
 * The worst dated state among several observations — what a station, lake or
 * crossing with several sensors shows as its overall signal. "void" entries are
 * ignored unless every entry is "void" (or there are none), because one dead
 * sensor beside a live one is not a station with no data.
 */
export function worstSignal(states: Iterable<SignalState>): SignalState {
  let worst: SignalState = "void";
  for (const state of states) {
    if (SEVERITY[state] > SEVERITY[worst]) worst = state;
  }
  return worst;
}
