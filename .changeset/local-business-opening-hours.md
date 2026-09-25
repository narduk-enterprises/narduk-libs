---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

`useLocalBusinessSchema` now emits its `openingHours` strings (the schema.org
text form, `'Mo-Fr 09:00-17:00'`) under `openingHours`. They used to land under
`openingHoursSpecification`, whose range is structured
`OpeningHoursSpecification` objects, so every page that passed opening hours
shipped invalid LocalBusiness JSON-LD (narduk-libs#944). The option type is now
exported as `LocalBusinessOptions`.
