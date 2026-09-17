---
'@narduk-enterprises/narduk-testkit': minor
---

Add `expectAccessible`, the estate accessibility bar: zero serious/critical axe
violations on the routes a PR is gated on (Logan, 2026-09-17, "Zero
serious/critical in the PR subset"). Moderate and minor findings are recorded
and do not fail.

`playwright/accessibility` previously only asserted a scan the app had already
built against a recorded baseline. That ledger answers "did this change move the
debt?" and deliberately tolerates known debt, so it is not a shipping gate — and
because each app built its own `AxeBuilder`, the tag set and any disabled rules
were per-app and free to drift.

`expectAccessible` owns the scan instead, so the rule set is the estate's:
`WCAG_2_1_AA_TAGS` (2.1 AA, the level the products claim, rather than the 2.2
set the ledger uses) plus `ESTATE_DISABLED_AXE_RULES`. That list ships EMPTY and
the empty list is the position — a disabled rule is permanent silence on every
route of every app, so an entry must show the rule is wrong on this stack and
carry a reason and a link. The rules such a list usually exists for (`region`,
`landmark-one-main`, `page-has-heading-one`, `heading-order`) are
best-practice-tagged and never reach the gate.

A failure carries both halves of the evidence: one line per blocking violation
in the message (rule id, impact, first selector, help URL), and the full
violations JSON at every impact attached to the Playwright test, because the
sub-threshold findings are the inventory the next piece of work is planned from.
The helper returns that report so a spec can aggregate routes.

Also exported for composition and testing: `AXE_IMPACT_ORDER`,
`isImpactAtOrAbove` (fails closed on a missing or unrecognised impact),
`partitionViolationsByImpact`, `summarizeViolation`, `countViolationsByImpact`
(rules AND nodes — one rule over sixty nodes is a day of work),
`buildAccessibilityReport`, `runEstateAxeScan`, `analyzeWithAxeBuilder` and
`resolveAxeBuilder`.

`@axe-core/playwright` remains an OPTIONAL peer and this package still does not
import it: the load is a dynamic import behind a `string`-typed specifier, so an
app using only the ledger helpers installs no scanner, and an app calling
`expectAccessible` without the peer gets a sentence naming the package instead
of a module-resolution stack trace.

`AxeViolation` gains optional `helpUrl` and `description`, and
`AxeViolationNode` an optional `html`; all three are additive.
