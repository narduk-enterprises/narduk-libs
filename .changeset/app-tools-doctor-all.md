---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk-app doctor --all`: one command with one verdict line, `DOCTOR PASS|WARN|FAIL -- <reason>`, followed by each leg's own report. It composes the existing legs and reimplements none of them: bare `doctor`'s prerequisites, `doctor --adoption` (foundation, toolchain, shared-UI, coverage and deployment checks, plus the security-header and live probes with `--live`), and `doctor --audit`. Exit 1 only on FAIL. An undecided adoption requirement or an unreachable registry reads WARN, never red. `--json` prints the verdict and all three leg reports as one object. Bare `doctor`, `--adoption` and `--audit` are unchanged (#376).
