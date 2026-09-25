---
'@narduk-enterprises/journeys': patch
---

`digestJourney` keeps string, template and regex literals verbatim when it
normalizes a step body, so a step that types `'a;b'` no longer digests the same
as one that types `'ab'`. Loader semicolons and indentation in code are still
ignored, and a body whose literals hold no `;` and no whitespace but single
spaces digests exactly as before.
