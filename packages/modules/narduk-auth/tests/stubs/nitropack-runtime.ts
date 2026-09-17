export function useRuntimeConfig() {
  return {
    authBackend: 'local',
    public: {
      authBackend: 'local',
      authRequireMfa: false,
      appName: 'Test',
    },
  }
}

export function defineNitroPlugin<T>(plugin: T): T {
  return plugin
}
