/**
 * The journey-runner declaration contract.
 *
 * The normative source is the spec this package implements:
 * agent-infrastructure `skills/visual-qa/references/journey-runner-spec.md`
 * (agent-infrastructure#851, PR #852). Where a comment here disagrees with the
 * spec, the spec wins and the divergence is a bug.
 *
 * The core is deliberately runtime-neutral: no Playwright, no simulator, no
 * test-runner imports. Narrative consumers import prose from a catalog with no
 * browser installed (the spec's import-safety rule, §2.3).
 */
export const RUN_SCHEMA = 'njr-run/1';
//# sourceMappingURL=types.js.map