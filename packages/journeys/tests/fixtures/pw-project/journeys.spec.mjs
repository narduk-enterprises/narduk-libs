import { registerJourneys } from '../../../dist/web.js'
import { brokenCatalog, catalog } from './catalog.mjs'

const base = process.env.NJR_BASE
if (!base) throw new Error('NJR_BASE is required')

async function getJson(path) {
  const response = await fetch(base + path)
  if (!response.ok) throw new Error(`${path} -> ${response.status}`)
  return response.json()
}

const world = {
  async prepare(scenarioId) {
    const loaded = await fetch(`${base}/load?scenario=${scenarioId}`, { method: 'POST' }).then(
      (response) => response.json(),
    )
    return { scenarioId: loaded.scenario, generation: loaded.generation }
  },
  async generation() {
    const facts = await getJson('/api/world.json')
    return facts.generation
  },
  async appRevision() {
    const facts = await getJson('/version')
    return facts.revision
  },
}

registerJourneys({
  catalog: process.env.NJR_BROKEN === '1' ? brokenCatalog : catalog,
  world,
  base,
  outRoot: process.env.NJR_OUT ?? '.journeys/out',
  environment: 'fixture',
  profileName: 'desktop',
  commit: 'fixturecommit00',
  declarationDigest: process.env.NJR_DIGEST ?? 'sha256:unset',
})
