import { eq } from 'drizzle-orm'
import { createError } from 'h3'

import { users } from '#narduk-core/schema'

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
  // Browsers treat a backslash as a slash, so '/\\evil.example' leaves the origin.
  if (
    !redirectPath.startsWith('/') ||
    redirectPath.startsWith('//') ||
    // eslint-disable-next-line no-control-regex -- rejects control characters on purpose
    /[\\\u0000-\u001f\u007f]/.test(redirectPath)
  ) {
    return DEFAULT_DEMO_REDIRECT_PATH
  }

  return redirectPath || DEFAULT_DEMO_REDIRECT_PATH
}
