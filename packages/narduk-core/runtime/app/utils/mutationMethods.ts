/**
 * The set of HTTP methods that modify server state.
 *
 * Used across `useAppFetch`, `useCsrfFetch`, and `fetch.client.ts` to decide
 * whether to inject the `X-Requested-With` CSRF header. Centralised here to
 * avoid drift if the set ever needs to change.
 */
export const MUTATION_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
