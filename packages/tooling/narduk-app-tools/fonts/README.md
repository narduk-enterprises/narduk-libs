# Brand card fonts

`narduk-app assets generate` typesets the default share card with these fonts,
so a card renders the same on a Mac, a lane guest and CI regardless of the fonts
the machine has installed.

| File                   | Source                                                      | Upstream instance           | Declared face             |
| ---------------------- | ----------------------------------------------------------- | --------------------------- | ------------------------- |
| `ne-brand-display.ttf` | Bricolage Grotesque (OFL 1.1, `OFL-BricolageGrotesque.txt`) | wght 800, wdth 100, opsz 96 | NE Brand Display, Regular |
| `ne-brand-text.ttf`    | Bricolage Grotesque (OFL 1.1, `OFL-BricolageGrotesque.txt`) | wght 500, wdth 100, opsz 14 | NE Brand Text, Regular    |
| `ne-brand-mono.ttf`    | JetBrains Mono (OFL 1.1, `OFL-JetBrainsMono.txt`)           | wght 700                    | NE Brand Mono, Regular    |

The upstream instance is the weight the outlines were cut at. Each file declares
itself Regular, weight 400, not variable, because the card renderer asks for the
family at weight 400 (`src/brand/render.ts`); `tests/brand-font.test.ts` locks
that.

Each is a static instance of the upstream variable font
(`github.com/google/fonts`, `ofl/`), subset to Latin-1 plus common punctuation
with fontTools, and renamed `NE Brand Display`, `NE Brand Text` and
`NE Brand Mono` as the OFL asks of a modified version.
