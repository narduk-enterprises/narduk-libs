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
