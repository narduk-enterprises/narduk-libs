---
'@narduk-enterprises/narduk-app-tools': patch
---

Give the development build workspace a repository of its own, so an app's
existing repository-shaped checks (`git rev-parse --show-toplevel`, `git
ls-files -co --exclude-standard`, `git status`) run against the captured source
instead of refusing the deploy with "fatal: not a git repository". The workspace
repository is local-only, excludes the publisher's git identity, signing, hooks
and init templates, and is kept between deploys so each iteration costs one
incremental commit.
