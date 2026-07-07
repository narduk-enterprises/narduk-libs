import { eq } from 'drizzle-orm'

import { users } from '#layer/orm-tables'

import { useDatabase } from './database'

import type { H3Event } from 'h3'

const DEFAULT_DEMO_REDIRECT_PATH = '/dashboard'

export interface DemoSessionUser {
  email: string
  id: string
  isAdmin: boolean | null
  name: string | null
}

export async function resolveDemoSessionUser(
  event: H3Event,
  demoEmail: string,
): Promise<DemoSessionUser> {
  const db = useDatabase(event)
  const user = await db.select().from(users).where(eq(users.email, demoEmail)).get()

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: `Demo account ${demoEmail} is unavailable. Ensure it is seeded.`,
    })
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
  }
}

export function normalizeDemoRedirectPath(input: unknown): string {
  if (typeof input !== 'string') {
    return DEFAULT_DEMO_REDIRECT_PATH
  }

  const redirectPath = input.trim()
  if (!redirectPath.startsWith('/') || redirectPath.startsWith('//')) {
    return DEFAULT_DEMO_REDIRECT_PATH
  }

  return redirectPath || DEFAULT_DEMO_REDIRECT_PATH
}
