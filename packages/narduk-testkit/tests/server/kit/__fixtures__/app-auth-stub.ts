export function getCurrentSupabaseContext(_event: unknown): Promise<{
  session: { access_token: string }
}> {
  return Promise.resolve({ session: { access_token: 'stub-access-token' } })
}
