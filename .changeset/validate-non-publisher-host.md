---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app development validate` works from a contributor host while the
repository is enrolled from another workstation (narduk-libs#827). Without a
local activation record it checks GitHub: when the held workflows are disabled,
it requests validation, so a PR can get its `ci / Required` result. When none is
held, it refuses and names them, instead of claiming that normal delivery
validates pushes. `development status --remote` on such a host also lists the
held workflows.
