---
'@narduk-enterprises/narduk-app': patch
'@narduk-enterprises/narduk-devices': patch
'@narduk-enterprises/narduk-platform': patch
'@narduk-enterprises/narduk-postgres': patch
'@narduk-enterprises/narduk-realtime': patch
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/narduk-timeseries': patch
'@narduk-enterprises/narduk-ui': patch
'@narduk-enterprises/status-runtime': patch
---

The package's `volta.node` pin moves from 22.22.3 to 24.21.0, the Node the
workspace root and CI run (narduk-libs#647). No runtime change: the pin only
selects the Node that Volta runs for commands inside the package directory. It
now matches the ABI of the native modules that the root install builds.
