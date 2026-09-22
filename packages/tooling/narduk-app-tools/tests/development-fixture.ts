import { developmentSchema } from '../src/development-config.js'

export function developmentFixture() {
  const command = { executable: 'pnpm', args: ['run', 'test'], cwd: '.', timeoutSeconds: 60 }
  const selector = { project: 'fixture', environment: 'prd', config: 'app', key: 'APP_SECRET' }
  return developmentSchema.parse({
    defaultTargetSet: 'primary',
    components: {
      web: {
        appDir: 'apps/web',
        wranglerConfig: 'apps/web/wrangler.jsonc',
        accountId: 'a'.repeat(32),
        workerName: 'example',
        origins: ['https://example.com'],
        bindings: [],
        build: command,
        assertArtifact: command,
        behavior: { kind: 'command', command },
        artifactDirectory: 'apps/web/.output',
        deploymentCredential: selector,
        buildsCredential: selector,
      },
    },
    targetSets: { primary: { components: ['web'], checks: [command] } },
    install: {
      ...command,
      executable: 'gh-packages-run',
      args: ['pnpm', 'install', '--frozen-lockfile'],
    },
    automation: {
      workflows: ['.github/workflows/ci.yml'],
      manualValidationWorkflow: '.github/workflows/validate.yml',
      inventoryReference: 'fixture-writers',
    },
  })
}
