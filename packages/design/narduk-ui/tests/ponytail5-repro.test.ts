// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import { classifySignal } from "../_core";
import { NsRangeBar } from "../instruments";

const band = { low: 4, high: 8 } as never;

describe("ponytail5 #5 range bar missing reason is a second root", () => {
  it("renders exactly one root element", () => {
    const w = mount(NsRangeBar, {
      props: { value: null, band, missingReason: "Gauge offline" } as never,
    });
    expect(w.text()).toContain("Gauge offline");
    expect(w.find(".ns-range .ns-range__reason").exists()).toBe(true);
  });
});

describe("ponytail5 #6 range bar without a label", () => {
  it("keeps a cell for the label column so the track stays in column 2", () => {
    const w = mount(NsRangeBar, {
      props: { value: 5, band, unit: "ft" } as never,
    });
    expect(w.find(".ns-range").element.children.length).toBe(3);
  });
});

describe("ponytail5 #7 zone-less timestamp", () => {
  it("classifies the same under a Chicago clock as under UTC", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const previous = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = classifySignal("2026-07-30T11:50:00", 10, now);
      process.env.TZ = "America/Chicago";
      const chicago = classifySignal("2026-07-30T11:50:00", 10, now);
      expect({ utc, chicago }).toEqual({ utc: "live", chicago: "live" });
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
