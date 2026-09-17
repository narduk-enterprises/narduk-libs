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

export async function fetchWorkerPlainTextVars(
  options: WorkerPlainTextOptions,
): Promise<Record<string, string>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(options.scriptName)}`
  const versions = await fetchCloudflareJson<{ items?: Array<{ id?: string }> }>(
    `${base}/versions?per_page=5`,
    options.apiToken,
    fetchImpl,
  )
  const versionId = versions.items?.[0]?.id
  if (!versionId) throw new Error(`No deployed Worker versions found for ${options.scriptName}`)
  const detail = await fetchCloudflareJson<{
    resources?: { bindings?: Array<{ name?: string; text?: string; type?: string }> }
  }>(`${base}/versions/${encodeURIComponent(versionId)}`, options.apiToken, fetchImpl)

  const vars: Record<string, string> = {}
  for (const binding of detail.resources?.bindings ?? []) {
    if (binding.type === 'plain_text' && binding.name && typeof binding.text === 'string') {
      vars[binding.name] = binding.text
    }
  }
  return vars
}
