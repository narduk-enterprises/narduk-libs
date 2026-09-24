import {
  describeActiveWorkerResolution,
  resolveActiveWorkerVersion,
  type WorkerDeployment,
} from './worker-deployment.js'

interface CloudflareErrorBody {
  errors?: Array<{ code?: number; message?: string }>
  result?: unknown
  result_info?: unknown
  success?: boolean
}

/**
 * Cloudflare's V4 page-pagination block. Every field is optional because a
 * caller must never assume it is there: the shape is documented, but which
 * endpoints populate it -- and whether they clamp `per_page` below what was
 * asked -- is not something a fixture can establish. `per_page` is the size the
 * API ACTUALLY APPLIED, which is the only safe basis for reading a short page
 * as the end of a collection.
 */
export interface CloudflarePageInfo {
  page?: number
  per_page?: number
  count?: number
  total_count?: number
  total_pages?: number
}

/** A Cloudflare response with its pagination block, when it carried one. */
export interface CloudflareEnvelope<T> {
  result: T
  pageInfo: CloudflarePageInfo | null
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * `result_info` sits beside `result` in the documented V4 envelope. This also
 * looks inside `result` because that placement has not been verified live for
 * every endpoint, and missing it costs a consumer a wrong "end of collection"
 * verdict -- the expensive direction. Absent or unusable, the answer is `null`,
 * never a guess.
 */
function readPageInfo(body: CloudflareErrorBody): CloudflarePageInfo | null {
  const candidates = [
    body.result_info,
    typeof body.result === 'object' && body.result !== null
      ? (body.result as Record<string, unknown>).result_info
      : undefined,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const raw = candidate as Record<string, unknown>
    const info: CloudflarePageInfo = {
      page: numberOrUndefined(raw.page),
      per_page: numberOrUndefined(raw.per_page),
      count: numberOrUndefined(raw.count),
      total_count: numberOrUndefined(raw.total_count),
      total_pages: numberOrUndefined(raw.total_pages),
    }
    if (Object.values(info).some((value) => value !== undefined)) return info
  }
  return null
}

export interface WorkerPlainTextOptions {
  accountId: string
  apiToken: string
  fetchImpl?: typeof fetch
  scriptName: string
}

/**
 * One Cloudflare REST read, with Cloudflare's own `success`/`errors` envelope
 * turned into a thrown `Error`, and its pagination block handed back when it
 * carried one. Exported because the promote path pages the Versions list
 * (`../promote.ts`) and a second copy of this would be a second place for the
 * error shape to diverge.
 */
export async function fetchCloudflareEnvelope<T>(
  url: string,
  apiToken: string,
  fetchImpl: typeof fetch,
): Promise<CloudflareEnvelope<T>> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiToken}` } })
  const body = (await response.json()) as CloudflareErrorBody
  if (!response.ok || body.success === false) {
    const detail =
      body.errors
        ?.map((error) => error.message ?? '')
        .filter(Boolean)
        .join('; ') ||
      response.statusText ||
      'Unknown Cloudflare API error'
    throw new Error(`Cloudflare API ${response.status}: ${detail}`)
  }
  if (body.result === undefined) throw new Error('Cloudflare API response did not include result')
  return { result: body.result as T, pageInfo: readPageInfo(body) }
}

/** The common case: the result alone. */
export async function fetchCloudflareJson<T>(
  url: string,
  apiToken: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  return (await fetchCloudflareEnvelope<T>(url, apiToken, fetchImpl)).result
}

function isDeployment(value: unknown): value is WorkerDeployment {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && Array.isArray(record.versions)
}

/**
 * Deployments envelopes vary: REST uses `{ deployments }`, some fixtures use
 * `{ items }`, wrangler `--json` is a bare array. The whole list is returned.
 * Callers must still resolve via allocation, never `items[0]`.
 */
export function readDeploymentList(result: unknown): WorkerDeployment[] {
  if (Array.isArray(result)) return result.filter((row) => isDeployment(row))
  if (typeof result !== 'object' || result === null) return []
  const record = result as Record<string, unknown>
  if (Array.isArray(record.deployments)) {
    return record.deployments.filter((row) => isDeployment(row))
  }
  if (Array.isArray(record.items)) return record.items.filter((row) => isDeployment(row))
  return []
}

export async function listWorkerDeploymentsViaApi(options: {
  accountId: string
  apiToken: string
  scriptName: string
  fetchImpl?: typeof fetch
}): Promise<WorkerDeployment[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(options.scriptName)}/deployments`
  return readDeploymentList(await fetchCloudflareJson<unknown>(url, options.apiToken, fetchImpl))
}

export async function fetchWorkerPlainTextVars(
  options: WorkerPlainTextOptions,
): Promise<Record<string, string>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(options.scriptName)}`
  const deployments = await listWorkerDeploymentsViaApi({
    accountId: options.accountId,
    apiToken: options.apiToken,
    scriptName: options.scriptName,
    fetchImpl,
  })
  const resolved = resolveActiveWorkerVersion(deployments)
  if (resolved.kind !== 'resolved') {
    throw new Error(describeActiveWorkerResolution(options.scriptName, resolved))
  }
  const detail = await fetchCloudflareJson<{
    resources?: { bindings?: Array<{ name?: string; text?: string; type?: string }> }
  }>(`${base}/versions/${encodeURIComponent(resolved.versionId)}`, options.apiToken, fetchImpl)

  const vars: Record<string, string> = {}
  for (const binding of detail.resources?.bindings ?? []) {
    if (binding.type === 'plain_text' && binding.name && typeof binding.text === 'string') {
      vars[binding.name] = binding.text
    }
  }
  return vars
}
