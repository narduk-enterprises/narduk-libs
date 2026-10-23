// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import { formatDelta, formatValue } from "../_core";
import { NsFreshnessChip, NsReadoutTile } from "../instruments";

describe("a missing tile's reason is not colored as a rise or fall", () => {
  it("has no direction class when the value is missing", () => {
    const w = mount(NsReadoutTile, {
      props: { label: "L", value: null, delta: -1.2, missingReason: "Gauge offline" } as never,
    });
    expect(w.find(".ns-tile__delta").classes().join(" ")).not.toMatch(/--(up|down)/);
  });
});

describe("bad state or decimals do not throw", () => {
  it("renders an unknown state as void", () => {
    const w = mount(NsFreshnessChip, { props: { state: "LIVE" } as never });
    expect(w.classes()).toContain("ns-chip--void");
  });
  it.each([-1, Number.NaN, 101])("formatValue tolerates decimals %s", (decimals) => {
    expect(() => formatValue(1.2, { decimals })).not.toThrow();
    expect(() => formatDelta(1.2, { decimals })).not.toThrow();
  });
});
