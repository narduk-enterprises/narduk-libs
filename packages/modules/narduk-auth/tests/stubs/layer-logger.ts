export function useLogger() {
  return {
    child: () => ({
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    }),
  }
}
