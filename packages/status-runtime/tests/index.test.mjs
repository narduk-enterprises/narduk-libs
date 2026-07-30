import { readFile } from "node:fs/promises";

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

  it("publishes declarations without changing the runtime export", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const declarations = await readFile(new URL("../index.d.mts", import.meta.url), "utf8");

    expect(packageJson.main).toBe("index.mjs");
    expect(packageJson.types).toBe("./index.d.mts");
    expect(packageJson.exports).toEqual({ ".": "./index.mjs" });
    expect(packageJson.files).toEqual(["index.mjs", "index.d.mts", "README.md"]);
    expect(declarations).toContain("export function resolveSourceRevision");
    expect(declarations).toContain("export const designSystemFontLinks");
    expect(declarations).toContain("export const designSystemThemeColor");
  });
});
