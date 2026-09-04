interface CloudflareErrorBody {
  errors?: Array<{ code?: number; message?: string }>
  result?: unknown
  success?: boolean
}

export interface WorkerPlainTextOptions {
  accountId: string
  apiToken: string
  fetchImpl?: typeof fetch
  scriptName: string
}

async function fetchJson<T>(url: string, apiToken: string, fetchImpl: typeof fetch): Promise<T> {
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
  return body.result as T
}

export async function fetchWorkerPlainTextVars(
  options: WorkerPlainTextOptions,
): Promise<Record<string, string>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/workers/scripts/${encodeURIComponent(options.scriptName)}`
  const versions = await fetchJson<{ items?: Array<{ id?: string }> }>(
    `${base}/versions?per_page=5`,
    options.apiToken,
    fetchImpl,
  )
  const versionId = versions.items?.[0]?.id
  if (!versionId) throw new Error(`No deployed Worker versions found for ${options.scriptName}`)
  const detail = await fetchJson<{
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
