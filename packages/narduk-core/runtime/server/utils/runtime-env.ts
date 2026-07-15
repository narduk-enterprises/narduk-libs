import { readWorkerRuntimeEnv, type WorkerRuntimeEnv } from './worker-env'

import type { H3Event } from 'h3'

type RuntimeConfigLike = Record<string, unknown>

export interface RuntimeReadOptions {
  config?: RuntimeConfigLike
  fallback?: unknown
}

export function trimRuntimeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function hostnameFromUrl(value: string): string {
  const trimmed = trimRuntimeString(value)
  if (!trimmed) return ''

  try {
    return new URL(trimmed).hostname
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
}

export function readRuntimeEnvOverlay(
  event: H3Event,
  nodeEnv?: WorkerRuntimeEnv,
): WorkerRuntimeEnv {
  return readWorkerRuntimeEnv(event, nodeEnv)
}

export function hasRuntimeEnvKey(env: WorkerRuntimeEnv, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key)
}

export function hasRuntimeEnvBinding(event: H3Event, key: string): boolean {
  return hasRuntimeEnvKey(readRuntimeEnvOverlay(event), key)
}

export function readRuntimeString(
  event: H3Event,
  key: string,
  options: RuntimeReadOptions = {},
): string {
  const env = readRuntimeEnvOverlay(event)
  if (hasRuntimeEnvKey(env, key)) return trimRuntimeString(env[key])

  const fromFallback = trimRuntimeString(options.fallback)
  if (fromFallback) return fromFallback

  return ''
}

export function readRuntimeStringFromKeys(
  event: H3Event,
  keys: string[],
  options: RuntimeReadOptions & { fallbacks?: unknown[] } = {},
): string {
  const env = readRuntimeEnvOverlay(event)
  for (const key of keys) {
    if (hasRuntimeEnvKey(env, key)) return trimRuntimeString(env[key])
  }

  for (const fallback of options.fallbacks ?? []) {
    const fromFallback = trimRuntimeString(fallback)
    if (fromFallback) return fromFallback
  }

  return readRuntimeString(event, keys[0] ?? '', options)
}

export function readRuntimeBoolean(
  event: H3Event,
  key: string,
  options: RuntimeReadOptions & { defaultValue?: boolean } = {},
): boolean {
  const env = readRuntimeEnvOverlay(event)
  if (hasRuntimeEnvKey(env, key)) {
    const raw = trimRuntimeString(env[key]).toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true
    if (['0', 'false', 'no', 'off'].includes(raw)) return false
    return options.defaultValue ?? false
  }

  if (typeof options.fallback === 'boolean') return options.fallback
  const fallback = trimRuntimeString(options.fallback).toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(fallback)) return true
  if (['0', 'false', 'no', 'off'].includes(fallback)) return false

  return options.defaultValue ?? false
}

export function readRuntimeStringList(
  event: H3Event,
  key: string,
  options: RuntimeReadOptions & { fallbackList?: unknown[] } = {},
): string[] {
  const env = readRuntimeEnvOverlay(event)
  if (hasRuntimeEnvKey(env, key)) {
    const raw = trimRuntimeString(env[key])
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
  }

  if (Array.isArray(options.fallbackList)) {
    return options.fallbackList
      .map((entry) => trimRuntimeString(entry))
      .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
  }

  return []
}
