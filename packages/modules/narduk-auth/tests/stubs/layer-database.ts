export const databaseStub = {
  executedQueries: [] as unknown[],
  /** Every `.values(...)` payload, so a test can prove nothing was inserted. */
  inserts: [] as unknown[],
  rows: [] as unknown[],
  reset() {
    this.executedQueries = []
    this.inserts = []
    this.rows = []
  },
}

function createChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  const methods = [
    'delete',
    'from',
    'insert',
    'limit',
    'onConflictDoUpdate',
    'returning',
    'select',
    'set',
    'update',
    'where',
  ]
  for (const method of methods) {
    chain[method] = () => chain
  }
  chain.values = (payload: unknown) => {
    databaseStub.inserts.push(payload)
    return chain
  }
  return chain
}

export function useDatabase() {
  return createChain()
}

export function createAppDatabase() {
  return function useAppDatabase() {
    return createChain()
  }
}

export async function executeDatabaseQuery<T>(query: unknown): Promise<T> {
  databaseStub.executedQueries.push(query)
  return databaseStub.rows as T
}

export async function getDatabaseRow<T>(query: unknown): Promise<T | undefined> {
  databaseStub.executedQueries.push(query)
  return (Array.isArray(databaseStub.rows) ? databaseStub.rows[0] : databaseStub.rows) as
    T | undefined
}
