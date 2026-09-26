---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/create-narduk-app': patch
---

Add `NeProse` (narduk-libs#1005): a markdown document rendered in the suite's
type scale — h2/h3 headings (a `#` h1 is demoted to h2, since the page header
owns the h1), paragraphs, nested ordered and unordered lists, fenced code with
its language, aligned tables, blockquotes, rules, and inline code, bold, italic
and links. Takes `source` (markdown) or a pre-parsed `blocks` AST.

The markdown subset is parsed by a small, pure, dependency-free parser exported
from the package root as `parseProse()`, with `proseOutline()` to build a table
of contents: every heading gets a unique slug `id`. Rendering is element by
element with no `v-html`, so raw HTML in the source is text, and a link keeps
its `href` only for `http(s):`, `mailto:` or a scheme-less (relative, `#`, `?`)
target; `javascript:` and every other scheme render the text alone. The AST and
prop types (`NeProseProps`, `NeProseBlock`, `NeProseInline`, `NeProseHeading`,
…) are exported for the design kit to mirror.

The eslint-config and narduk-app-tools shared-component lists name `NeProse` so
the drift and item-13 tests match `narduk-shell`'s registry. The libs explorer
gains the `ne-prose` example its coverage check requires. `create-narduk-app`
takes the patch because it pins `narduk-shell`.
