---
'@narduk-enterprises/create-narduk-app': patch
---

A generated private app now ships `.github/actionlint.yaml` declaring the self-hosted runner labels its workflows name — `proxmox` and `linux-ci` (`dependabot-merge.yml`), plus `proxmox-deploy` for the D1 `preview-d1.yml` template — so the shared workflow's required `caller-lint` job no longer fails a fresh app's first CI run with `label "proxmox" is unknown` (narduk-libs#778). The labels come from the same arrays the `runs-on:` blocks are written from, the file is a managed `upgrade` target like the workflows it describes, and a test re-runs actionlint's runner-label rule over every emitted workflow. Public apps name no self-hosted label and get no file.
