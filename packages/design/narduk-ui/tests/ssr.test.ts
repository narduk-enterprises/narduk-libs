/*
 * Server-render proof — suite bar for narduk-ui instruments (#269).
 *
 * Mount tests under happy-dom give every instrument a `document`. Consumers
 * on Nuxt/Nitro do not: the first render happens on a server — for the
 * Cloudflare Workers preset, a runtime with no `window` and no `document`.
 * A component that reaches for either at setup time throws there while the
 * happy-dom suite stays green.
 *
 * This file therefore runs in the `node` environment (vitest.config.ts's
 * default; the mount suite opts INTO happy-dom with a file directive, and
 * this one deliberately does not) and renders through `@vue/server-renderer`.
 * `expect(...).resolves` is not enough on its own — a component can render an
 * empty string without throwing — so each case also asserts that real markup
 * came back.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "@vue/server-renderer";
import { createSSRApp, type Component } from "vue";

import { MISSING, SIGNALS } from "../_core";
import { NsFreshnessChip, NsLevelWell, NsRangeBar, NsReadoutTile } from "../instruments";

/** The globals a Workers-style server runtime does not have. */
it("runs in an environment with no DOM, which is the whole point of this file", () => {
  expect(typeof document).toBe("undefined");
  expect(typeof window).toBe("undefined");
});

function render(component: Component, props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(component, props));
}

const now = new Date("2026-07-30T12:00:00Z");
const band = { low: 55, high: 88, label: "Normal for July" };

const cases: Array<[string, Component, Record<string, unknown>, string]> = [
  ["NsFreshnessChip", NsFreshnessChip, { state: "live" }, "ns-chip--live"],
  ["NsLevelWell", NsLevelWell, { value: 47.3, median: 60, name: "Lake Travis" }, "ns-well__fill"],
  [
    "NsRangeBar",
    NsRangeBar,
    { value: 47.3, band, unit: "ft", label: "Lake Travis" },
    "ns-range__marker",
  ],
  ["NsReadoutTile", NsReadoutTile, { label: "Stage", value: 12.3, unit: "ft" }, "ns-tile__value"],
];

describe("server rendering without a DOM", () => {
  for (const [name, component, props, marker] of cases) {
    it(`${name} renders markup instead of throwing`, async () => {
      const html = await render(component, props);
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain(marker);
    });
  }

  it("carries the chip's accessible meaning into the server output, not only after hydration", async () => {
    const html = await render(NsFreshnessChip, {
      observedAt: "2026-07-30T11:56:00Z",
      intervalMinutes: 10,
      now,
      showAge: true,
    });
    expect(html).toContain("ns-chip--live");
    expect(html).toContain(SIGNALS.live.label);
    // Vue HTML-escapes the apostrophe in "source's" (`&#39;`) on the server.
    expect(html).toContain("Observation inside the source");
    expect(html).toContain("own publishing interval.");
    expect(html).toContain("ns-chip__sr");
    expect(html).toContain("4 min");
  });

  it("server-renders the missing variants so a directory's first paint already shows the gap", async () => {
    const well = await render(NsLevelWell, {
      value: null,
      median: 60,
      missingReason: "Gauge offline",
    });
    expect(well).toContain("ns-well--missing");
    expect(well).toContain(MISSING);
    expect(well).toContain("Gauge offline");

    const bar = await render(NsRangeBar, {
      value: null,
      band,
      missingReason: "Not published this hour",
    });
    expect(bar).toContain("ns-range--missing");
    expect(bar).toContain("ns-range__hatch");
    expect(bar).toContain("Not published this hour");

    const tile = await render(NsReadoutTile, {
      label: "Stage",
      value: null,
      missingReason: "Gauge offline",
    });
    expect(tile).toContain("ns-tile--missing");
    expect(tile).toContain(MISSING);
    expect(tile).toContain("Gauge offline");
  });

  it("does not touch a DOM global merely by importing the instruments entry", async () => {
    await expect(render(NsFreshnessChip, { state: "void" })).resolves.toContain("ns-chip");
  });
});
