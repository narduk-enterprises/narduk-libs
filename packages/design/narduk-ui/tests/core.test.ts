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
import { ageMinutes, classifySignal, formatAge } from "../_core/signal";

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
