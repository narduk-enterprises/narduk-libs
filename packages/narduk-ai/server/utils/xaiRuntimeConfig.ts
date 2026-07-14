import { useRuntimeConfig } from 'nitropack/runtime'

import { validateXaiApiKey } from '../../shared/utils/xaiRuntimeConfig'

import type { H3Event } from 'h3'

export function getXaiApiKey(event: H3Event): string {
  const config = useRuntimeConfig(event) as { xaiApiKey?: unknown }
  return validateXaiApiKey(config.xaiApiKey)
}
