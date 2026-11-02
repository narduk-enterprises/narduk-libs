---
'@narduk-enterprises/create-narduk-app': minor
---

Generated `ci.yml` declares a `nightly` boolean input on `workflow_dispatch`, so
the estate night dispatcher (fleet `Config/night-dispatch.json`, which replaces
the late-firing `schedule:` crons) can start it: GitHub answers HTTP 422 to a
dispatch that carries an input the workflow does not declare. A workflow reads
it as `github.event.inputs.nightly == 'true'` where it used to read
`github.event_name == 'schedule'` (narduk-enterprises/workflows README,
"Night-dispatched runs"). The generator never writes a `schedule:` trigger into
a workflow, and tests pin that for every generated workflow and that
`upgrade --write` leaves a converted `ci.yml` (nightly input, background-runner
routing, no cron) alone.
