---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

development enter refuses an already-disabled held workflow unless it is retired or `--accept-prior-state` is journaled. Adopting `disabled_manually` as `desiredState` silently left CI and promote off after exit (narduk-libs#754). Exit and `development status` now name any workflow restored to a disabled state.
