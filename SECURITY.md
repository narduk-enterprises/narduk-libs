# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability
reporting for this repository:
<https://github.com/narduk-enterprises/narduk-libs/security/advisories/new>. Do
not open a public issue or pull request for a security problem.

You will get an acknowledgement within 7 days. Fixes ship as ordinary releases
of the affected package; the advisory is published once the fix is available.

## Supported versions

The latest published version of each package in this repository receives
security fixes. When a package ships a new major N, the previous major N-1 keeps
security fixes until its consumers have migrated or for 90 days after N,
whichever is longer; see
[`docs/package-support-window.md`](docs/package-support-window.md).

## What is enabled here

CodeQL code scanning (default setup), secret scanning with push protection,
Dependabot alerts and security updates, and private vulnerability reporting are
enabled on this repository.
