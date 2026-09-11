/**
 * Layer auth stub.
 *
 * The list routes under test need an authenticated caller, not a session
 * implementation; `authStub.user` is what `requireAuth` / `requireAdmin` answer.
 */
export const authStub = {
  user: {
    authMethod: 'session',
    email: 'admin@list.test',
    id: 'user-1',
    isAdmin: true,
    name: 'Admin',
    scopes: [] as string[],
  },
}

export async function requireAuth() {
  return authStub.user
}

export async function requireAdmin() {
  return authStub.user
}
