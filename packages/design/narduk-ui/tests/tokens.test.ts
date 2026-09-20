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

  it.each(sources.map((s) => [s.name, s.text] as const))(
    "%s spells opaque white as the surface channel, not #fff",
    (name, text) => {
      const stripped = name === "tokens.css" ? text.replaceAll("--ns-surface: #ffffff;", "") : text;
      expect(stripped.match(/#ffff(?:ff)?\b/g) ?? [], `${name} hardcodes white`).toEqual([]);
    },
  );
});
