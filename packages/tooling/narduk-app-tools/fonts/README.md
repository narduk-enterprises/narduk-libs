# Brand card fonts

`narduk-app assets generate` typesets the default share card with these fonts,
so a card renders the same on a Mac, a lane guest and CI regardless of the fonts
the machine has installed.

| File                   | Source                                                      | Instance                    |
| ---------------------- | ----------------------------------------------------------- | --------------------------- |
| `ne-brand-display.ttf` | Bricolage Grotesque (OFL 1.1, `OFL-BricolageGrotesque.txt`) | wght 800, wdth 100, opsz 96 |
| `ne-brand-text.ttf`    | Bricolage Grotesque (OFL 1.1, `OFL-BricolageGrotesque.txt`) | wght 500, wdth 100, opsz 14 |
| `ne-brand-mono.ttf`    | JetBrains Mono (OFL 1.1, `OFL-JetBrainsMono.txt`)           | wght 700                    |

Each is a static instance of the upstream variable font
(`github.com/google/fonts`, `ofl/`), subset to Latin-1 plus common punctuation
with fontTools, and renamed `NE Brand Display`, `NE Brand Text` and
`NE Brand Mono` as the OFL asks of a modified version.
