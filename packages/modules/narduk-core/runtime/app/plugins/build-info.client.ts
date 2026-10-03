import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

import { runWhenBrowserIdle } from '../build-idle'
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

export default defineNuxtPlugin((nuxtApp) => {
  const buildWindow = window as BuildInfoWindow
  const config = useRuntimeConfig().public
  const appName = readRuntimeConfigString(config.appName, 'Unknown App')
  const appVersion = readRuntimeConfigString(config.appVersion, 'unknown')
  const buildVersion = readRuntimeConfigString(config.buildVersion, appVersion)
  const buildTime = readRuntimeConfigString(config.buildTime, 'unknown')

  // `localBuildTime` is formatted on first read (the idle log below or a
  // devtools read of `window.__NARDUK_BUILD__`), never during plugin setup
  // (narduk-libs#1380). It stays an enumerable own property, so spreading or
  // `JSON.stringify` see the same five fields as before.
  let localBuildTime: string | undefined
  const payload: BuildInfoPayload = {
    appName,
    appVersion,
    buildVersion,
    buildTime,
    get localBuildTime() {
      localBuildTime ??= formatBuildTimeLocal(buildTime, 'unknown')
      return localBuildTime
    },
  }

  const marker = `${appVersion}:${buildVersion}:${buildTime}`
  if (buildWindow.__NARDUK_BUILD_LOGGED__ === marker) return

  buildWindow.__NARDUK_BUILD__ = payload
  buildWindow.__NARDUK_BUILD_LOGGED__ = marker

  nuxtApp.hooks.hookOnce('app:mounted', () => {
    runWhenBrowserIdle(() => {
      console.warn(
        `[build] ${payload.appName} v${payload.appVersion} · ${payload.buildVersion} · deployed ${payload.localBuildTime}`,
      )
    })
  })
})
