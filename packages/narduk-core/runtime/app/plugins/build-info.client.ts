import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

import { formatBuildTimeLocal } from '../utils/formatBuildTimeLocal'
import { readRuntimeConfigString } from '../utils/readRuntimeConfigString'

interface BuildInfoPayload {
  appName: string
  appVersion: string
  buildTime: string
  buildVersion: string
  localBuildTime: string
}

type BuildInfoWindow = Window &
  typeof globalThis & {
    __NARDUK_BUILD__?: BuildInfoPayload
    __NARDUK_BUILD_LOGGED__?: string
  }

export default defineNuxtPlugin(() => {
  const buildWindow = window as BuildInfoWindow
  const config = useRuntimeConfig().public
  const appName = readRuntimeConfigString(config.appName, 'Unknown App')
  const appVersion = readRuntimeConfigString(config.appVersion, 'unknown')
  const buildVersion = readRuntimeConfigString(config.buildVersion, appVersion)
  const buildTime = readRuntimeConfigString(config.buildTime, 'unknown')
  const localBuildTime = formatBuildTimeLocal(buildTime, 'unknown')
  const payload: BuildInfoPayload = {
    appName,
    appVersion,
    buildVersion,
    buildTime,
    localBuildTime,
  }

  const marker = `${payload.appVersion}:${payload.buildVersion}:${payload.buildTime}`
  if (buildWindow.__NARDUK_BUILD_LOGGED__ === marker) return

  buildWindow.__NARDUK_BUILD__ = payload
  buildWindow.__NARDUK_BUILD_LOGGED__ = marker

  console.warn(
    `[build] ${payload.appName} v${payload.appVersion} · ${payload.buildVersion} · deployed ${payload.localBuildTime}`,
  )
})
