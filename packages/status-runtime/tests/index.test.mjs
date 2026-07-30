import { describe, expect, it } from "vitest";

import { designSystemFontLinks, designSystemThemeColor, resolveSourceRevision } from "../index.mjs";

describe("status runtime configuration", () => {
  it("resolves source revisions in release-authority order", () => {
    expect(
      resolveSourceRevision({
        NARDUK_SOURCE_REVISION: " explicit ",
        WORKERS_CI_COMMIT_SHA: "workers",
        GITHUB_SHA: "github",
      }),
    ).toBe("explicit");
    expect(resolveSourceRevision({ WORKERS_CI_COMMIT_SHA: "workers", GITHUB_SHA: "github" })).toBe(
      "workers",
    );
    expect(resolveSourceRevision({ GITHUB_SHA: "github" })).toBe("github");
    expect(resolveSourceRevision({})).toBe("");
  });

  it("ships one immutable shared design-system contract", () => {
    expect(Object.isFrozen(designSystemFontLinks)).toBe(true);
    expect(designSystemFontLinks).toHaveLength(3);
    expect(designSystemFontLinks.at(-1)?.href).toContain("Instrument+Sans");
    expect(designSystemFontLinks.at(-1)?.href).toContain("IBM+Plex+Mono");
    expect(designSystemThemeColor).toBe("rgb(14 20 24)");
  });
});
