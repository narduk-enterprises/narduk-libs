import { describe, expect, it } from "vitest";

import {
  MISSING,
  bandGeometry,
  bandPosition,
  deltaDirection,
  formatDelta,
  formatValue,
  positionPercent,
} from "../_core/measure";
import {
  ageMinutes,
  classifySignal,
  classifySignalByAge,
  formatAge,
  worstSignal,
} from "../_core/signal";

describe("measurement contracts", () => {
  it("renders missing values explicitly and formats present values", () => {
    expect(formatValue(null)).toBe(MISSING);
    expect(formatValue(Number.NaN)).toBe(MISSING);
    expect(formatValue(12.345, { decimals: 2, unit: "ft" })).toBe("12.35 ft");
    expect(formatDelta(-1.2, { decimals: 1 })).toBe("−1.2");
    expect(deltaDirection(0)).toBeNull();
    expect(deltaDirection(1)).toBe("up");
  });

  it("groups thousands in en-US so a 7-digit measure can be read (#1497)", () => {
    expect(formatValue(1055144, { decimals: 0 })).toBe("1,055,144");
    expect(formatValue(1953900, { decimals: 0, unit: "acre-ft" })).toBe("1,953,900 acre-ft");
    expect(formatValue(1234.5, { decimals: 2 })).toBe("1,234.50");
    expect(formatValue(-1234567.891, { decimals: 1 })).toBe("-1,234,567.9");
    expect(formatValue(999.5, { decimals: 1 })).toBe("999.5");
    expect(formatValue(2026, { decimals: 0, grouping: false })).toBe("2026");
    expect(formatValue(1055144, { decimals: 0, grouping: false })).toBe("1055144");
    expect(formatValue(null, { decimals: 0 })).toBe(MISSING);
    expect(formatDelta(12345.6, { decimals: 1, unit: "ft" })).toBe("+12,345.6 ft");
    expect(formatDelta(-12345.6, { decimals: 1 })).toBe("−12,345.6");
    expect(formatDelta(12345.6, { decimals: 1, grouping: false })).toBe("+12345.6");
    expect(formatDelta(0)).toBe("0.00");
  });

  it("clamps values and reference bands to their domain", () => {
    expect(positionPercent(-5, 0, 10)).toBe(0);
    expect(positionPercent(15, 0, 10)).toBe(100);
    expect(positionPercent(5.5, 0, 10)).toBe(55);
    expect(bandGeometry({ low: 2, high: 8 }, 0, 10)).toEqual({
      leftPercent: 20,
      widthPercent: 60,
    });
    expect(bandPosition(1, { low: 2, high: 8 })).toBe("below");
    expect(bandPosition(5, { low: 2, high: 8 })).toBe("inside");
    expect(bandPosition(9, { low: 2, high: 8 })).toBe("above");
  });
});

describe("signal contracts", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("classifies observations relative to their source cadence", () => {
    expect(classifySignal(null, 10, now)).toBe("void");
    expect(classifySignal("2026-07-30T11:55:00Z", 10, now)).toBe("live");
    expect(classifySignal("2026-07-30T11:40:00Z", 10, now)).toBe("aging");
    expect(classifySignal("2026-07-30T11:00:00Z", 10, now)).toBe("stale");
    expect(classifySignal("2026-07-30T12:30:00Z", 10, now)).toBe("void");
  });

  it("formats deterministic observation ages", () => {
    expect(ageMinutes("2026-07-30T11:56:00Z", now)).toBe(4);
    expect(formatAge("2026-07-30T11:56:00Z", now)).toBe("4 min");
    expect(formatAge("2026-07-30T09:00:00Z", now)).toBe("3 h");
    expect(formatAge(null, now)).toBe(MISSING);
  });
});

describe("classifySignalByAge", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  // lakestat-us: Live under 6 h, Stale at 48 h.
  const lake = { live: 360, aging: 2880 };

  it("treats each limit as an exclusive upper bound", () => {
    expect(classifySignalByAge(minutesAgo(359), lake, now)).toBe("live");
    expect(classifySignalByAge(minutesAgo(360), lake, now)).toBe("aging");
    expect(classifySignalByAge(minutesAgo(2879), lake, now)).toBe("aging");
    expect(classifySignalByAge(minutesAgo(2880), lake, now)).toBe("stale");
  });

  it("treats each limit as an inclusive upper bound when asked", () => {
    // borderwaitstat-us style: "60 minutes or less" is still Live.
    const inclusive = { live: 60, aging: 180, stale: 1440, inclusive: true };
    expect(classifySignalByAge(minutesAgo(60), inclusive, now)).toBe("live");
    expect(classifySignalByAge(minutesAgo(60.5), inclusive, now)).toBe("aging");
    expect(classifySignalByAge(minutesAgo(180), inclusive, now)).toBe("aging");
    expect(classifySignalByAge(minutesAgo(181), inclusive, now)).toBe("stale");
    expect(classifySignalByAge(minutesAgo(1440), inclusive, now)).toBe("stale");
    expect(classifySignalByAge(minutesAgo(1441), inclusive, now)).toBe("void");
    expect(classifySignalByAge(minutesAgo(180), { ...inclusive, stale: undefined }, now)).toBe(
      "aging",
    );
    expect(classifySignalByAge(minutesAgo(181), { live: 60, aging: 180, inclusive: true }, now)).toBe(
      "stale",
    );
  });

  it("keeps exclusive bounds when inclusive is false or absent", () => {
    expect(classifySignalByAge(minutesAgo(60), { live: 60, aging: 180, inclusive: false }, now)).toBe(
      "aging",
    );
    expect(classifySignalByAge(minutesAgo(60), { live: 60, aging: 180 }, now)).toBe("aging");
  });

  it("keeps the future tolerance the same under inclusive bounds", () => {
    const inclusive = { live: 60, aging: 180, inclusive: true };
    expect(classifySignalByAge(minutesAgo(-5), inclusive, now)).toBe("live");
    expect(classifySignalByAge(minutesAgo(-6), inclusive, now)).toBe("void");
  });

  it("reads past the stale ceiling as void", () => {
    // buoys: live 90, aging 360, no data past 24 h.
    const buoy = { live: 91, aging: 361, stale: 1441 };
    expect(classifySignalByAge(minutesAgo(1440), buoy, now)).toBe("stale");
    expect(classifySignalByAge(minutesAgo(1441), buoy, now)).toBe("void");
  });

  it("accepts epoch milliseconds and Date for both arguments", () => {
    expect(classifySignalByAge(now - 60_000, lake, new Date(now))).toBe("live");
    expect(classifySignalByAge(new Date(now - 60_000), lake, now)).toBe("live");
  });

  it("reads a zone-less date-time as UTC, not local time", () => {
    expect(classifySignalByAge("2026-07-30T11:59:00", { live: 2, aging: 10 }, now)).toBe("live");
  });

  it("tolerates small clock skew and voids anything further ahead", () => {
    expect(classifySignalByAge(minutesAgo(-4), lake, now)).toBe("live");
    expect(classifySignalByAge(minutesAgo(-6), lake, now)).toBe("void");
    expect(classifySignalByAge(minutesAgo(-30), { ...lake, futureToleranceMinutes: 60 }, now)).toBe(
      "live",
    );
  });

  it("never reads an undateable observation or bad limits as live", () => {
    expect(classifySignalByAge(null, lake, now)).toBe("void");
    expect(classifySignalByAge("not a date", lake, now)).toBe("void");
    expect(classifySignalByAge(Number.NaN, lake, now)).toBe("void");
    expect(classifySignalByAge(minutesAgo(1), { live: 0, aging: 10 }, now)).toBe("void");
    expect(classifySignalByAge(minutesAgo(1), { live: 10, aging: 5 }, now)).toBe("void");
    expect(classifySignalByAge(minutesAgo(1), { ...lake, stale: 100 }, now)).toBe("void");
    expect(classifySignalByAge(minutesAgo(1), { ...lake, stale: Number.NaN }, now)).toBe("void");
    expect(
      classifySignalByAge(minutesAgo(-600), { ...lake, futureToleranceMinutes: Number.NaN }, now),
    ).toBe("void");
    expect(classifySignalByAge(minutesAgo(1), { ...lake, futureToleranceMinutes: -1 }, now)).toBe(
      "void",
    );
  });
});

describe("worstSignal", () => {
  it("picks the most severe dated state", () => {
    expect(worstSignal(["live", "stale", "aging"])).toBe("stale");
    expect(worstSignal(["live", "aging"])).toBe("aging");
  });

  it("ignores void beside a dated state and is void only when nothing is dated", () => {
    expect(worstSignal(["void", "live"])).toBe("live");
    expect(worstSignal(["void", "void"])).toBe("void");
    expect(worstSignal([])).toBe("void");
  });
});
