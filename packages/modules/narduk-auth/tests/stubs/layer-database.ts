export const databaseStub = {
  executedQueries: [] as unknown[],
  rows: [] as unknown[],
  reset() {
    this.executedQueries = []
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
    'offset',
    'onConflictDoUpdate',
    'orderBy',
    'returning',
    'select',
    'set',
    'update',
    'values',
    'where',
  ]
  for (const method of methods) {
    chain[method] = () => chain
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

export async function getDatabaseRows<T>(query: unknown): Promise<T[]> {
  databaseStub.executedQueries.push(query)
  return databaseStub.rows as T[]
}

export async function getDatabaseRow<T>(query: unknown): Promise<T | undefined> {
  databaseStub.executedQueries.push(query)
  return (Array.isArray(databaseStub.rows) ? databaseStub.rows[0] : databaseStub.rows) as
    T | undefined
}
