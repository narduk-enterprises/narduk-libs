---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
---

Add `NeMessageProse`: what an agent or a bot wrote, formatted instead of showing `**`, backticks and bullet markers. Block mode is `NeProse` on `messageProseBlocks()` in a compact skin that takes its type, leading and ink from its container, with an optional measured `clamp` (lines) and a Show more / Show less button that exists only when the text overflows. Inline mode (`mode="inline"`) renders one line of bold, em, code and links for a title, option, table cell or log line, with `title` set to the plain text. Only `https:` links are links (new tab); every other link renders as its text. New exports: `messageProseBlocks`, `messageProseInline`, `messageProseText`, `unflattenLists`, and the `NeMessageProseProps`, `NeMessageProseMode` and `MessageProseOptions` types. `eslint-config` and `narduk-app-tools` learn the new shared component name; `create-narduk-app` pins the new shell.
