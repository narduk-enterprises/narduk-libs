import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Strips block comments and whole-line `//` comments.
 *
 * Every assertion below is about what the code *does*, so the prose that
 * explains why must not be able to satisfy — or break — it. These files
 * describe the very identifiers being asserted against.
 */
function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n')
}

function readRoute(relativePath: string): string {
  return stripComments(readFileSync(join(packageRoot, 'server/api/auth', relativePath), 'utf8'))
}

/**
 * The passkey routes' authentication class is load-bearing, not stylistic
 * (narduk-libs#125 gap G5, risk R2).
 *
 * A consuming app's boundary may treat the whole `/api/auth/` prefix as public
 * — the operator portal's `PUBLIC_PATH_PREFIXES` does, and must, because
 * sign-in lives there. So the ONLY thing standing between an anonymous caller
 * and enrolling their own authenticator onto someone's account is this
 * package choosing `defineUserMutation` for the registration ceremony. If a
 * future edit relaxes one of these to `definePublicMutation`, that is an
 * account-takeover primitive, and this test is what refuses it.
 *
 * The table is exhaustive on purpose: a new passkey route must be classified
 * here before it ships.
 */
const ROUTE_CLASSES = [
  { file: 'passkeys/registration/options.post.ts', expect: 'defineUserMutation' },
  { file: 'passkeys/registration/verify.post.ts', expect: 'defineUserMutation' },
  { file: 'passkeys/[id].delete.ts', expect: 'defineUserMutation' },
  { file: 'passkeys.get.ts', expect: 'defineUserQuery' },
  // Sign-in itself must be reachable without a session, exactly like
  // login.post.ts, and carries the same authLogin rate-limit policy.
  { file: 'passkeys/authentication/options.post.ts', expect: 'definePublicMutation' },
  { file: 'passkeys/authentication/verify.post.ts', expect: 'definePublicMutation' },
] as const

describe('passkey route authentication classes', () => {
  for (const route of ROUTE_CLASSES) {
    it(`${route.file} is exported as ${route.expect}`, () => {
      const source = readRoute(route.file)
      expect(source).toContain(`export default ${route.expect}(`)
    })
  }

  it('registration and management are NEVER public', () => {
    for (const route of ROUTE_CLASSES.filter((entry) => entry.expect !== 'definePublicMutation')) {
      const source = readRoute(route.file)
      expect(source).not.toContain('definePublicMutation')
      expect(source).not.toContain('definePublicQuery')
    }
  })

  it('enumerates every passkey route that exists on disk', () => {
    // Reads the filesystem rather than a second hand-written list, so adding a
    // passkey route without classifying it above fails here instead of
    // shipping unclassified.
    const listed = new Set<string>(ROUTE_CLASSES.map((route) => route.file))
    const onDisk = new Set<string>(
      readdirSync(join(packageRoot, 'server/api/auth'), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .map((absolute) => relative(join(packageRoot, 'server/api/auth'), absolute))
        .filter((file) => file === 'passkeys.get.ts' || file.startsWith(`passkeys${sep}`))
        .map((file) => file.split(sep).join('/')),
    )

    expect([...onDisk].sort()).toEqual([...listed].sort())
  })

  it('every passkey management route refuses an API-key principal', () => {
    // requireAuth accepts an API-key bearer as a first-class principal, so a
    // leaked machine token would otherwise be able to enrol a passkey — turning
    // a revocable token into a persistent interactive login.
    for (const route of ROUTE_CLASSES.filter((entry) => entry.expect !== 'definePublicMutation')) {
      expect(readRoute(route.file)).toContain('assertPasskeyManagementPrincipal(user)')
    }
  })

  it('the authentication ceremony takes no user identifier', () => {
    // No email, no username, no allowCredentials: the sign-in endpoints must
    // never be able to confirm or deny that an account exists.
    const options = readRoute('passkeys/authentication/options.post.ts')
    expect(options).not.toContain('email')
    expect(options).not.toContain('parseBody')

    const verify = readRoute('passkeys/authentication/verify.post.ts')
    expect(verify).not.toContain('email')
  })

  it('binds both sign-in endpoints to the authLogin rate-limit policy', () => {
    for (const file of [
      'passkeys/authentication/options.post.ts',
      'passkeys/authentication/verify.post.ts',
    ]) {
      expect(readRoute(file)).toContain('RATE_LIMIT_POLICIES.authLogin')
    }
  })
})

describe('passkey ceremony invariants in webauthn-core', () => {
  const source = stripComments(
    readFileSync(join(packageRoot, 'server/lib/app-auth/webauthn-core.ts'), 'utf8'),
  )

  it('claims the challenge before verifying, so a failed attempt is burned', () => {
    const claimIndex = source.indexOf('consumeWebauthnChallenge')
    const verifyIndex = source.indexOf('verifyRegistrationResponse({')
    expect(claimIndex).toBeGreaterThan(-1)
    expect(verifyIndex).toBeGreaterThan(-1)
    expect(claimIndex).toBeLessThan(verifyIndex)
  })

  it('requires user verification on both ceremonies', () => {
    expect(source.match(/requireUserVerification: true/gu)?.length).toBe(2)
    expect(source).not.toContain('requireUserVerification: false')
  })

  it('binds the registration challenge back to the session user', () => {
    expect(source).toContain('claimed.userId !== user.id')
  })

  it('refuses a credential registered under a different RP ID', () => {
    expect(source).toContain('credential.rpId !== config.rpId')
  })

  it('requires discoverable credentials so authentication needs no identifier', () => {
    expect(source).toContain("residentKey: 'required'")
    expect(source).toContain('requireResidentKey: true')
    expect(source).not.toContain('allowCredentials')
  })

  it('never trusts the request host for the RP ID or origin', () => {
    expect(source).not.toContain('getRequestHost')
    expect(source).not.toContain('getRequestURL')
    expect(source).toContain('expectedOrigin: config.origins')
    expect(source).toContain('expectedRPID: config.rpId')
  })

  it('writes the new counter conditionally on the counter it verified against', () => {
    expect(source).toContain('eq(authWebauthnCredentials.counter, credential.counter)')
  })
})
