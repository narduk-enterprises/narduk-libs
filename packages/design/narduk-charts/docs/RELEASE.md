# Release Runbook

`@narduk-enterprises/narduk-charts` publishes to the Forgejo npm registry:

`https://code.platform.nard.uk/api/packages/narduk-enterprises/npm/`

## Prerequisites

- Root `.npmrc` contains only the scoped Forgejo registry line.
- The publish workflow receives `FORGEJO_TOKEN`.
- `NODE_AUTH_TOKEN` is set to the same value during install and publish steps.

## Release Steps

1. Update the implementation.
2. Run local verification:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm run size`
   - `npm pack`
3. Bump the package version in `package.json`.
4. Update `CHANGELOG.md`.
5. Commit the release changes.
6. Create a tag in the format `vX.Y.Z`.
7. Push the branch and the tag to the Forgejo-connected remote.
8. Confirm the workflow completed successfully in Forgejo Actions.
9. Confirm the package version appears in Forgejo Packages and installs cleanly from a consumer app.

## Consumer Install Smoke

Use a consumer app with the same scoped registry configured:

```bash
npm install @narduk-enterprises/narduk-charts
```

Then verify the shared stylesheet resolves:

```ts
import '@narduk-enterprises/narduk-charts/style.css'
```
