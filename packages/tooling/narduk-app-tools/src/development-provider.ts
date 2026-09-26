import { z } from 'zod'
import type { DevelopmentComponent, DevelopmentVaultSelector } from './development-config.js'
import { readDevelopmentSecret, type DevelopmentSecretReader } from './development-process.js'
import type { LiveScriptTriggers } from './development-script-triggers.js'
import {
  currentDeployment,
  soleDeployedVersionId,
  listWorkerVersionsViaApi,
  type WorkerDeployment,
  type WorkerVersion,
} from './promote.js'

const deploymentSchema = z.object({
  id: z.string().min(1),
  created_on: z.string(),
  versions: z.array(z.object({ version_id: z.uuid(), percentage: z.number() })).min(1),
})
const triggerDefinitionSchema = z.object({
  external_script_id: z.string().regex(/^[a-f0-9]{1,64}$/u),
  repo_connection_uuid: z.uuid(),
  build_token_uuid: z.uuid(),
  trigger_name: z.string(),
  build_command: z.string(),
  deploy_command: z.string(),
  root_directory: z.string(),
  branch_includes: z.array(z.string()),
  branch_excludes: z.array(z.string()),
  path_includes: z.array(z.string()),
  path_excludes: z.array(z.string()),
  build_caching_enabled: z.boolean(),
})
export type DevelopmentTriggerDefinition = z.infer<typeof triggerDefinitionSchema>
export interface SavedDevelopmentTrigger {
  originalId: string
  definition: DevelopmentTriggerDefinition
  variables: Record<
    string,
    { isSecret: boolean; plainValue?: string; source?: DevelopmentVaultSelector }
  >
  retired?: boolean
  restoredId?: string
  variablesRestored?: boolean
}
export interface DevelopmentProviderState {
  deploymentId: string
  versionId: string
  newestVersionId: string
  requiredSecretNames: string[]
}

/** `TimeoutError: <message>; cause <code>` for a request that never produced a response. */
function describeRequestFailure(error: unknown): string {
  if (!(error instanceof Error)) return `${typeof error}; cause none`
  const cause = error.cause as { code?: unknown } | undefined
  const code = typeof cause?.code === 'string' ? cause.code : 'none'
  return `${error.name}: ${error.message}; cause ${code}`
}

/** No write is retried. A timeout is an unknown outcome requiring provider inspection. */
export class DevelopmentCloudflare {
  #deploymentToken?: string
  #buildsToken?: string
  constructor(
    readonly component: DevelopmentComponent,
    private readonly readSecret: DevelopmentSecretReader = readDevelopmentSecret,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private token(management: boolean): string {
    if (management) return (this.#buildsToken ??= this.readSecret(this.component.buildsCredential))
    return (this.#deploymentToken ??= this.readSecret(this.component.deploymentCredential))
  }

  private async request(
    path: string,
    management: boolean,
    method = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    const token = this.token(management)
    let response: Response
    try {
      response = await this.fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${this.component.accountId}${path}`,
        {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        },
      )
    } catch (error) {
      // Keep the cause: a timeout, a DNS failure and a reset connection need
      // different responses (narduk-libs#1096). The path carries no account id
      // or token; the query string is dropped.
      throw new Error(
        `Cloudflare ${method} ${path.split('?')[0]} did not complete (${describeRequestFailure(error)}); inspect provider state before retrying a write`,
        { cause: error },
      )
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(`Cloudflare returned an unreadable response (${response.status})`)
    }
    const envelope = z.object({ success: z.boolean(), result: z.unknown() }).safeParse(payload)
    if (!response.ok || !envelope.success || !envelope.data.success)
      throw new Error(
        `Cloudflare ${method} request failed (${response.status}); provider response bodies are not logged`,
      )
    return envelope.data.result
  }

  private scriptPath(): string {
    return `/workers/scripts/${encodeURIComponent(this.component.workerName)}`
  }

  /** Metadata list only: script bodies and version content can contain inlined credentials. */
  async workerTag(): Promise<string> {
    const scripts = z
      .array(z.object({ id: z.string(), tag: z.string() }))
      .parse(await this.request('/workers/scripts', false))
    const matches = scripts.filter((script) => script.id === this.component.workerName)
    if (matches.length !== 1 || !/^[a-f0-9]{1,64}$/u.test(matches[0].tag))
      throw new Error('Cannot uniquely resolve the approved Worker tag')
    return matches[0].tag
  }

  async versions(): Promise<WorkerVersion[]> {
    const listing = await listWorkerVersionsViaApi({
      accountId: this.component.accountId,
      apiToken: this.token(false),
      scriptName: this.component.workerName,
      limit: 100,
      fetchImpl: this.fetchImpl,
    })
    return listing.versions
  }

  async requiredSecrets(versionId: string): Promise<string[]> {
    const version = z
      .object({
        id: z.uuid(),
        resources: z.object({
          bindings: z.array(z.object({ type: z.string(), name: z.string() })),
        }),
      })
      .parse(
        await this.request(`${this.scriptPath()}/versions/${encodeURIComponent(versionId)}`, false),
      )
    if (version.id !== versionId) throw new Error('Provider returned a different Worker version')
    const names = version.resources.bindings
      .filter((binding) => binding.type === 'secret_text')
      .map((binding) => binding.name)
      .sort()
    for (const name of this.component.requiredRuntimeSecrets) {
      if (!names.includes(name))
        throw new Error(`Worker version is missing required runtime secret ${name}`)
    }
    return names
  }

  async inspect(): Promise<DevelopmentProviderState> {
    const result = z
      .object({ deployments: z.array(deploymentSchema) })
      .parse(await this.request(`${this.scriptPath()}/deployments`, false))
    const active = currentDeployment(result.deployments as WorkerDeployment[])
    const versionId = soleDeployedVersionId(active)
    if (!active || !versionId)
      throw new Error('Expected one proven serving version at 100% traffic')
    const versions = await this.versions()
    if (!versions[0]?.id) throw new Error('Provider version inventory is empty')
    const requiredSecretNames = await this.requiredSecrets(versionId)
    return {
      deploymentId: active.id,
      versionId,
      newestVersionId: versions[0].id,
      requiredSecretNames,
    }
  }

  async promote(versionId: string, message: string): Promise<void> {
    z.uuid().parse(versionId)
    await this.request(`${this.scriptPath()}/deployments`, false, 'POST', {
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
      annotations: { 'workers/message': message },
    })
  }

  /** Live script cron schedules, sorted (narduk-libs#756). */
  async schedules(): Promise<string[]> {
    const result = z
      .object({ schedules: z.array(z.object({ cron: z.string() })) })
      .parse(await this.request(`${this.scriptPath()}/schedules`, false))
    return result.schedules.map((schedule) => schedule.cron).sort()
  }

  /**
   * Live script crons and routes. Routes are zone route patterns plus custom
   * domain hostnames, the same set `wrangler triggers deploy` replaces.
   */
  async scriptTriggers(): Promise<LiveScriptTriggers> {
    const name = encodeURIComponent(this.component.workerName)
    const routes = z
      .array(z.object({ pattern: z.string() }))
      .parse(await this.request(`/workers/services/${name}/environments/production/routes`, false))
    const domains = z
      .array(z.object({ hostname: z.string(), service: z.string() }))
      .parse(await this.request(`/workers/domains?service=${name}&environment=production`, false))
    return {
      crons: await this.schedules(),
      routes: [
        ...routes.map((route) => route.pattern),
        ...domains
          .filter((domain) => domain.service === this.component.workerName)
          .map((domain) => domain.hostname),
      ].sort(),
    }
  }

  async triggers(
    tag: string,
  ): Promise<Array<{ id: string; definition: DevelopmentTriggerDefinition }>> {
    const records = z
      .array(
        z
          .object({
            trigger_uuid: z.uuid(),
            repo_connection: z.object({ repo_connection_uuid: z.uuid() }),
          })
          .passthrough(),
      )
      .parse(await this.request(`/builds/workers/${encodeURIComponent(tag)}/triggers`, true))
    return records.map((record) => ({
      id: record.trigger_uuid,
      definition: triggerDefinitionSchema.parse({
        ...record,
        repo_connection_uuid: record.repo_connection.repo_connection_uuid,
      }),
    }))
  }

  async saveTriggers(tag: string): Promise<SavedDevelopmentTrigger[]> {
    const saved: SavedDevelopmentTrigger[] = []
    for (const trigger of await this.triggers(tag)) {
      const variables = z
        .record(z.string(), z.object({ is_secret: z.boolean(), value: z.unknown().optional() }))
        .parse(await this.request(`/builds/triggers/${trigger.id}/environment_variables`, true))
      const safe: SavedDevelopmentTrigger['variables'] = {}
      for (const [name, variable] of Object.entries(variables)) {
        if (variable.is_secret) {
          const source = this.component.buildVariableSources[name]
          if (!source)
            throw new Error(`Protected build variable ${name} has no declared restoration source`)
          // Prove the source is readable before deleting any trigger; discard its value.
          if (!this.readSecret(source).trim())
            throw new Error(`Restoration source for ${name} is empty`)
          safe[name] = { isSecret: true, source }
        } else {
          if (typeof variable.value !== 'string')
            throw new Error(
              `Plain build variable ${name} cannot be restored from the provider response`,
            )
          safe[name] = { isSecret: false, plainValue: variable.value }
        }
      }
      saved.push({ originalId: trigger.id, definition: trigger.definition, variables: safe })
    }
    return saved
  }

  async retireTrigger(id: string): Promise<void> {
    z.uuid().parse(id)
    await this.request(`/builds/triggers/${id}`, true, 'DELETE')
  }

  async createTrigger(definition: DevelopmentTriggerDefinition): Promise<string> {
    const created = z
      .object({ trigger_uuid: z.uuid() })
      .parse(await this.request('/builds/triggers', true, 'POST', definition))
    return created.trigger_uuid
  }

  async restoreVariables(
    id: string,
    variables: SavedDevelopmentTrigger['variables'],
  ): Promise<void> {
    z.uuid().parse(id)
    const body: Record<string, { is_secret: boolean; value: string }> = {}
    for (const [name, variable] of Object.entries(variables)) {
      const value =
        variable.isSecret && variable.source
          ? this.readSecret(variable.source)
          : variable.plainValue
      if (typeof value !== 'string')
        throw new Error(`Build variable ${name} has no restoration value`)
      body[name] = { is_secret: variable.isSecret, value }
    }
    if (Object.keys(body).length)
      await this.request(`/builds/triggers/${id}/environment_variables`, true, 'PATCH', body)
    const actual = z
      .record(z.string(), z.object({ is_secret: z.boolean(), value: z.unknown().optional() }))
      .parse(await this.request(`/builds/triggers/${id}/environment_variables`, true))
    if (Object.keys(actual).sort().join('\0') !== Object.keys(variables).sort().join('\0'))
      throw new Error('Restored trigger variable names do not match the saved inventory')
    for (const [name, variable] of Object.entries(variables)) {
      if (
        actual[name].is_secret !== variable.isSecret ||
        (!variable.isSecret && actual[name].value !== variable.plainValue)
      )
        throw new Error(`Restored build variable ${name} does not match its saved settings`)
    }
  }
}
