---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-shell': minor
---

NeProse and `parseProse()` cover what operator-portal's skill renderer needs
(#1532). Every option defaults to the earlier behaviour, so existing consumers
render unchanged.

- Heading level 4: `maxHeadingLevel: 4` keeps `####` as h4 (default `3` still
  clamps it to h3). `NeProseBlock` and `NeProseHeading` `level` widen to
  `2 | 3 | 4`.
- `headingIdPrefix` prefixes every heading id and rewrites the document's own
  `#fragment` links to match, and `githubSlugs` makes the ids exactly GitHub's
  slug rule (`a & b` is `a--b`).
- `linkBase` resolves relative links against an absolute URL.
- `externalLinksNewTab` renders absolute `http(s)` links with `target="_blank"`
  and `rel="noopener"`.
- A `#table="{ block, index, heading, ordinal }"` slot replaces the built-in
  `<table>`, so an app keeps its own table component.
- Exports `parseProseInline` and `proseText`, with the `ParseProseOptions` and
  `NeProseTableSlotProps` types.
- NeProse renders h4 in the suite's type scale.

The generator pins `@narduk-enterprises/narduk-shell`, so `create-narduk-app` takes the new pin as a patch.
