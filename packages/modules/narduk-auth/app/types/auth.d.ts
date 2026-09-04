import type { AuthenticatorAssuranceLevels } from '@supabase/auth-js'

declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string | null
    isAdmin: boolean | null
    authSessionId?: string | null
    authSessionValidatedAt?: string | null
    authProvider?: string | null
    authProviders?: string[]
    authBackend?: 'local' | 'supabase'
    emailConfirmedAt?: string | null
    aal?: AuthenticatorAssuranceLevels | null
    needsPasswordSetup?: boolean
    recoveryMode?: boolean
  }
}

export {}
