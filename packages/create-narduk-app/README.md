# @narduk-enterprises/create-narduk-app

Deterministic, filesystem-only generation of app-owned Narduk Nuxt workspaces.

```ts
import { createNardukApp } from '@narduk-enterprises/create-narduk-app'

await createNardukApp({
  appName: 'harbor-notes',
  capabilities: ['auth', 'seo'],
  targetDir: './harbor-notes',
  noGit: true,
})
```

The CLI is `create-narduk-app`:

```sh
pnpm dlx @narduk-enterprises/create-narduk-app@0.1.11 harbor-notes \
  --display-name='Harbor Notes' \
  --description='A harbor log.' \
  --site-url=https://harbor.example \
  --target-dir=/absolute/path/harbor-notes \
  --capabilities=auth,seo,analytics,uploads,ai,mapkit \
  --visibility=private \
  --local-dev-port=3011 \
  --json
```

It supports `--force`, `--no-git`, and `--json`; it never mutates GitHub,
Cloudflare, Doppler, or package registries. The JSON report is returned to the
caller and is not persisted as scaffold metadata. Generated repositories commit
a non-secret `.npmrc` that reads `GH_PACKAGES_READ` from the process
environment, and routes both `@narduk-enterprises/*` and `@narduk-geo/*` to
GitHub Packages. The onboarding skill owns the first authenticated install and
commits the resulting frozen lockfile before CI is enabled.
