---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app adoption publish --report <adoption.json>` posts a
`doctor --adoption --json` artefact to the Operator Portal's estate ingest, so
an app's promote run feeds `/products/adoption` without carrying a copy of a
publisher script (narduk-libs#1422).

- The key is read from `OPERATOR_PORTAL_ADOPTION_INGEST_TOKEN` and never from
  argv (`--token` is a usage error); it is scrubbed from anything printed.
- Exit 0 stored, 1 not a schema-1 adoption artefact or a usage error, 2 key not
  provisioned (nothing sent, and it says so), 3 the portal refused the report or
  could not be reached. `--dry-run` builds the body and sends nothing.
- `--origin`, then `OPERATOR_PORTAL_URL`, then the production portal picks the
  target.
