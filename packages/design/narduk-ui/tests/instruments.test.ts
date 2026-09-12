// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import { MISSING, SIGNALS } from "../_core";
import { NsFreshnessChip, NsLevelWell, NsRangeBar, NsReadoutTile } from "../instruments";

const now = new Date("2026-07-30T12:00:00Z");

describe("NsFreshnessChip", () => {
  it("renders an explicit state with its accessible meaning", () => {
    const w = mount(NsFreshnessChip, { props: { state: "stale" } });
    expect(w.find(".ns-chip").classes()).toContain("ns-chip--stale");
    expect(w.text()).toContain(SIGNALS.stale.label);
    expect(w.find(".ns-chip").attributes("title")).toBe(SIGNALS.stale.meaning);
    expect(w.find(".ns-chip__sr").text()).toBe(SIGNALS.stale.meaning);
  });

  it("classifies from observedAt and the source interval against an injectable clock", () => {
    const live = mount(NsFreshnessChip, {
      props: { observedAt: "2026-07-30T11:55:00Z", intervalMinutes: 10, now },
    });
    expect(live.find(".ns-chip").classes()).toContain("ns-chip--live");
    expect(live.text()).toContain(SIGNALS.live.label);

    const aging = mount(NsFreshnessChip, {
      props: { observedAt: "2026-07-30T11:40:00Z", intervalMinutes: 10, now },
    });
    expect(aging.find(".ns-chip").classes()).toContain("ns-chip--aging");

    const stale = mount(NsFreshnessChip, {
      props: { observedAt: "2026-07-30T11:00:00Z", intervalMinutes: 10, now },
    });
    expect(stale.find(".ns-chip").classes()).toContain("ns-chip--stale");
  });

  it("falls back to void when neither state nor interval is given", () => {
    const w = mount(NsFreshnessChip);
    expect(w.find(".ns-chip").classes()).toContain("ns-chip--void");
    expect(w.text()).toContain(SIGNALS.void.label);
  });

  it("appends a compact age when showAge is set", () => {
    const w = mount(NsFreshnessChip, {
      props: {
        observedAt: "2026-07-30T11:56:00Z",
        intervalMinutes: 10,
        now,
        showAge: true,
        state: "stale",
      },
    });
    expect(w.find(".ns-chip__age").text()).toBe("· 4 min");
  });
});

describe("NsLevelWell", () => {
  it("renders the fill, dashed median and concatenated mono readout", () => {
    const w = mount(NsLevelWell, {
      props: { value: 47.3, median: 60, name: "Lake Travis" },
    });
    expect(w.find(".ns-well__fill").attributes("style")).toContain("height: 47.3%");
    expect(w.find(".ns-well__median").attributes("style")).toContain("bottom: 60%");
    expect(w.find(".ns-well__median-label").text()).toBe("MED");
    expect(w.find(".ns-well__value").text()).toBe("47.3%");
    expect(w.find(".ns-well__name").text()).toBe("Lake Travis");
    expect(w.find(".ns-well__body").attributes("aria-label")).toBe("47.3%, median 60%");
  });

  it("keeps the well footprint and shows the hatch plus em-dash when the value is missing", () => {
    const w = mount(NsLevelWell, {
      props: { value: null, median: 60, missingReason: "Gauge offline" },
    });
    expect(w.find(".ns-well").classes()).toContain("ns-well--missing");
    expect(w.find(".ns-well__fill").exists()).toBe(false);
    expect(w.find(".ns-well__hatch").text()).toBe(MISSING);
    expect(w.find(".ns-well__value").text()).toBe(MISSING);
    expect(w.find(".ns-well__body").attributes("aria-label")).toBe("Gauge offline");
  });
});

describe("NsRangeBar", () => {
  const band = { low: 55, high: 88, label: "Normal for July" };

  it("places the required band and the current marker on the same domain", () => {
    const w = mount(NsRangeBar, {
      props: { value: 47.3, band, unit: "ft", label: "Lake Travis" },
    });
    expect(w.find(".ns-range__label").text()).toBe("Lake Travis");
    expect(w.find(".ns-range__value").text()).toBe("47.3 ft");
    expect(w.find(".ns-range__band").attributes("style")).toContain("left: 55%");
    expect(w.find(".ns-range__band").attributes("style")).toContain("width: 33%");
    expect(w.find(".ns-range__marker").attributes("style")).toContain("left: 47.3%");
    expect(w.find(".ns-range__track").attributes("aria-label")).toBe(
      "47.3 ft, below the Normal for July band of 55–88",
    );
  });

  it("draws a hollow forecast marker when a forecast is given", () => {
    const w = mount(NsRangeBar, { props: { value: 70, band, forecast: 80 } });
    expect(w.find(".ns-range__forecast").attributes("style")).toContain("left: 80%");
  });

  it("keeps the track and shows the hatch plus reason when the value is missing", () => {
    const w = mount(NsRangeBar, {
      props: { value: null, band, missingReason: "Not published this hour" },
    });
    expect(w.find(".ns-range").classes()).toContain("ns-range--missing");
    expect(w.find(".ns-range__marker").exists()).toBe(false);
    expect(w.find(".ns-range__hatch").exists()).toBe(true);
    expect(w.find(".ns-range__value").text()).toBe(MISSING);
    expect(w.find(".ns-range__reason").text()).toBe("Not published this hour");
    expect(w.find(".ns-range__track").attributes("aria-label")).toBe("Not published this hour");
  });
});

describe("NsReadoutTile", () => {
  it("renders the label, mono value, unit and directional delta on one footprint", () => {
    const w = mount(NsReadoutTile, {
      props: {
        label: "Stage",
        value: 12.345,
        decimals: 2,
        unit: "ft",
        delta: -1.2,
        deltaUnit: "ft",
        deltaWindow: "24 h",
      },
    });
    expect(w.find(".ns-tile__label").text()).toBe("Stage");
    expect(w.find(".ns-tile__value").text()).toContain("12.35");
    expect(w.find(".ns-tile__unit").text()).toBe("ft");
    expect(w.find(".ns-tile__delta").text()).toContain("▼");
    expect(w.find(".ns-tile__delta").text()).toContain("−1.20 ft");
    expect(w.find(".ns-tile__delta").text()).toContain("/ 24 h");
    expect(w.find(".ns-tile__delta").classes()).toContain("ns-tile__delta--down");
  });

  it("keeps the delta line when the value is missing so the tile does not collapse", () => {
    const w = mount(NsReadoutTile, {
      props: { label: "Stage", value: null, missingReason: "Gauge offline" },
    });
    expect(w.find(".ns-tile").classes()).toContain("ns-tile--missing");
    expect(w.find(".ns-tile__value").text()).toBe(MISSING);
    expect(w.find(".ns-tile__unit").exists()).toBe(false);
    expect(w.find(".ns-tile__delta").text()).toContain("Gauge offline");
  });
});
