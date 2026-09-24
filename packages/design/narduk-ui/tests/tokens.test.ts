import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardrail 3 says components read `--ns-*` and never hardcode a colour. That
 * was not true: nineteen alpha composites across tokens.css and three
 * instruments were written as literal `rgb(14 20 24 / a)` and
 * `rgb(255 255 255 / a)`, which are the default ink and surface spelled out by
 * hand. Nothing caught them because every gate here is a unit test over
 * `_core`, and CSS has no type checker.
 *
 * They only became load-bearing when this package started telling apps they
 * may override any token (Logan, 2026-09-19: apps are designed independently).
 * An app that overrides --ns-ink now gets restyled text over machined chrome
 * still painted in the default ink -- the well ticks, the dashed median, the
 * band and tile hairlines, the hatch and every shadow.
 *
 * So the rule is mechanical: the ink and surface channels appear exactly once
 * each, as `--ns-ink-rgb` / `--ns-surface-rgb`, and everything else composites
 * through `rgb(var(--ns-…-rgb) / a)`.
 */

const pkgRoot = join(import.meta.dirname, "..");

function cssSources(): Array<{ name: string; text: string }> {
  const instruments = readdirSync(join(pkgRoot, "instruments"))
    .filter((f) => f.endsWith(".vue"))
    .map((f) => ({
      name: `instruments/${f}`,
      text: readFileSync(join(pkgRoot, "instruments", f), "utf8"),
    }));
  return [
    { name: "tokens.css", text: readFileSync(join(pkgRoot, "tokens.css"), "utf8") },
    ...instruments,
  ];
}

describe("token layer is the only styling contract", () => {
  const sources = cssSources();

  it("ships the two channel triplets the composites are built from", () => {
    const tokens = sources.find((s) => s.name === "tokens.css")!.text;
    expect(tokens).toContain("--ns-ink-rgb: 14 20 24;");
    expect(tokens).toContain("--ns-surface-rgb: 255 255 255;");
  });

  it.each(sources.map((s) => [s.name, s.text] as const))(
    "%s composites ink and surface through the channel tokens, never by hand",
    (name, text) => {
      // The two definitions are the only places the channels are written out.
      const body =
        name === "tokens.css" ? text.replaceAll(/--ns-(?:ink|surface)-rgb:[^;]+;/g, "") : text;
      const literals = body.match(/rgb\(\s*(?:14 20 24|255 255 255)\b[^)]*\)/g) ?? [];
      expect(literals, `${name} hardcodes the default ink/surface: ${literals.join(", ")}`).toEqual(
        [],
      );
    },
  );

  /**
   * The rgb() scan above misses a hex. `--ns-bezel-fill` was
   * `linear-gradient(180deg, #253039, #0e1418)` and passed it, while
   * `--ns-ink` is documented two hundred lines earlier as the "bezel base" --
   * so an app setting `--ns-ink` and `--ns-ink-rgb` restyled its text, hatch,
   * ticks, hairlines and every shadow and still got a bezel in the old ink.
   * `--ns-e2` and `--ns-e3` baked their top hairlines the same way.
   *
   * A colour may therefore only appear as the whole value of a `--ns-*`
   * declaration, where an app can override it. Inside a gradient, a shadow
   * list or a component rule it is unreachable, and that is the bug.
   */
  it.each(sources.map((s) => [s.name, s.text] as const))(
    "%s declares colours as tokens, never inline in a composite",
    (name, text) => {
      const withoutComments = text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
      const offenders = withoutComments
        .split("\n")
        .map((line) => line.trim())
        // A whole-value declaration is the one legal place for a literal.
        .filter((line) => !/^--ns-[a-z0-9-]+:\s*#[0-9a-f]{3,8};$/i.test(line))
        .flatMap((line) => line.match(/#[0-9a-f]{3,8}\b/gi) ?? []);
      expect(offenders, `${name} bakes a colour into a composite: ${offenders.join(", ")}`).toEqual(
        [],
      );
    },
  );
});

const PAGE_Z_LAYERS = [
  "base",
  "content",
  "raised",
  "sticky",
  "nav",
  "dropdown",
  "popover",
  "overlay",
  "modal",
  "toast",
  "max",
] as const;

const MAP_Z_LAYERS = [
  "map-tiles",
  "map-features",
  "map-labels",
  "map-selection",
  "map-controls",
] as const;

describe("phase 1c token scale (narduk-libs#535)", () => {
  const tokens = readFileSync(join(pkgRoot, "tokens.css"), "utf8");

  it("ships eleven page --ns-z layers plus the named map-internal layers", () => {
    expect(PAGE_Z_LAYERS).toHaveLength(11);
    for (const name of PAGE_Z_LAYERS) {
      expect(tokens).toMatch(new RegExp(`--ns-z-${name}:\\s*\\d+;`, "u"));
    }
    for (const name of MAP_Z_LAYERS) {
      expect(tokens).toMatch(new RegExp(`--ns-z-${name}:\\s*\\d+;`, "u"));
    }
  });

  it("uses Tailwind 40rem/64rem breakpoints, not 620/820/1080", () => {
    expect(tokens).toContain("@media (width < 40rem)");
    expect(tokens).toContain("@media (40rem <= width < 64rem)");
    expect(tokens).not.toMatch(/620px|820px|1080px/u);
    expect(tokens).toContain("--ns-bp-sm: 40rem;");
    expect(tokens).toContain("--ns-bp-lg: 64rem;");
  });

  it("maps --bs-* aliases onto --ns-* so the duplicate token set is one source", () => {
    const stems: string[] = [];
    for (const line of tokens.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("--bs-")) continue;
      const match = /^--bs-([a-z0-9-]+): var\(--ns-\1\);$/u.exec(trimmed);
      expect(match, `expected --bs-* alias, got ${trimmed}`).not.toBeNull();
      stems.push(match![1]);
    }
    expect(stems.length).toBeGreaterThanOrEqual(20);
    expect(stems).toEqual(expect.arrayContaining(["ink", "surface", "space-4", "r-md"]));
  });
});
