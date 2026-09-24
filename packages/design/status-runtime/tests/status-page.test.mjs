import { describe, expect, it } from "vitest";

import { parseHealthEnvelope, renderStatusPage } from "../index.mjs";

/** The /api/health envelope narduk-core documents (narduk-libs#370). */
const healthyEnvelope = {
  success: true,
  data: {
    status: "ok",
    timestamp: "2026-09-16T17:00:00.000Z",
    database: "not_applicable",
    missingAuthTables: [],
    checks: [
      {
        name: "database",
        required: false,
        result: "skipped",
        reason: "not-configured",
      },
      {
        name: "auth-tables",
        required: false,
        result: "skipped",
        reason: "auth-not-enabled",
      },
      {
        kind: "freshness",
        name: "observations-freshness",
        required: false,
        result: "pass",
        durationMs: 12,
        detail: {
          source: "ndbc-realtime-observations",
          warnAfterSeconds: 2700,
          failAfterSeconds: 21600,
          observedAt: "2026-09-16T16:55:00.000Z",
          ageSeconds: 300,
        },
      },
    ],
  },
};

describe("status / data-health page (narduk-libs#370)", () => {
  it("parses the narduk-core /api/health envelope", () => {
    const parsed = parseHealthEnvelope(healthyEnvelope);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected health envelope");
    expect(parsed.model.status).toBe("ok");
    expect(parsed.model.timestamp).toBe("2026-09-16T17:00:00.000Z");
    expect(parsed.model.database).toBe("not_applicable");
    expect(parsed.model.checks.map((check) => check.name)).toEqual([
      "database",
      "auth-tables",
      "observations-freshness",
    ]);
    expect(parsed.model.products).toEqual([
      {
        name: "observations-freshness",
        source: "ndbc-realtime-observations",
        observedAt: "2026-09-16T16:55:00.000Z",
        ageSeconds: 300,
        result: "pass",
        notice: false,
      },
    ]);
  });

  it("fails closed on a body that is not the health contract", () => {
    expect(parseHealthEnvelope(null).ok).toBe(false);
    expect(parseHealthEnvelope({ success: false }).ok).toBe(false);
    expect(parseHealthEnvelope({ success: true, data: { status: "fine" } }).ok).toBe(false);
  });

  it("renders overall status, checks, and freshness without requiring auth", () => {
    const html = renderStatusPage(healthyEnvelope, { appName: "Buoys" });
    expect(html).toContain("<h1>");
    expect(html).toContain("Operational");
    expect(html).toContain('role="status"');
    expect(html).toContain("observations-freshness");
    expect(html).toContain("ndbc-realtime-observations");
    expect(html).toContain('datetime="2026-09-16T16:55:00.000Z"');
    expect(html).toContain("database");
    expect(html).not.toContain("password");
    expect(html).not.toContain("login");
  });

  it("labels degraded and error in text, not only by colour", () => {
    const degraded = structuredClone(healthyEnvelope);
    degraded.data.status = "degraded";
    const freshness = degraded.data.checks[2];
    expect(freshness).toBeDefined();
    freshness.result = "fail";
    expect(renderStatusPage(degraded)).toContain("Degraded");

    const down = structuredClone(healthyEnvelope);
    down.data.status = "error";
    expect(renderStatusPage(down)).toContain("Outage");
  });

  it("escapes check names so a payload cannot inject markup", () => {
    const hostile = structuredClone(healthyEnvelope);
    hostile.data.checks[0].name = "<script>alert(1)</script>";
    const html = renderStatusPage(hostile);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("exposes landmarks a public status page needs", () => {
    const html = renderStatusPage(healthyEnvelope);
    expect(html).toContain("<main");
    expect(html).toContain("<h1>");
    expect(html).toContain("<h2>");
    expect(html).toMatch(/<table[\s\S]*<caption>/u);
    expect(html).toContain('lang="en"');
  });
});
