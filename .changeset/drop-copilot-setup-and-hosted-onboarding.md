---
'@narduk-enterprises/create-narduk-app': patch
---

Stop generating the GitHub-hosted workflows that tripped the Operator Portal's
runner-policy drift gate in every new app. The generator no longer emits
`.github/workflows/copilot-setup-steps.yml` (the Copilot coding agent is not
used in the estate; its `ubuntu-latest` job never ran) and the private
`ci.yml` no longer carries the hosted `Runner group onboarding` job
(`ubuntu-24.04`). A missing runner-group assignment is now caught centrally by
the portal's runner-queue-eligibility gate; the generated README tells the
author to run `scripts/register-app` before the first push.
`copilot-setup-steps.yml` is removed from the `upgrade` managed set; `upgrade`
has no removal mechanism, so an app deletes its existing copy by hand.
Patch: removes generated output only; the generator's internal helpers
`createCopilotSetupWorkflow`, `createRunnerOnboardingScript` and the
`RUNNER_ONBOARDING_*` constants are gone, no consumer-facing API changed.
