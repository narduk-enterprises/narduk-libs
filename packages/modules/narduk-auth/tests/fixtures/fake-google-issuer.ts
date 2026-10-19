/**
 * A fake Google OpenID Connect issuer for narduk-libs#1951's tests.
 *
 * It stands in for the two Google endpoints the server calls — the JWKS and
 * the token endpoint — through a `fetch` the test installs, and for the
 * browser's trip through Google's consent screen through `authorize`. Like
 * Google it hands out single-use codes bound to the client, the redirect URI
 * and the PKCE challenge, and mints RS256 ID tokens with a key published only
 * in its own JWKS. `tamper` lets a test mint the wrong `aud`, `nonce`, `iss`
 * or `exp` the way a hostile or broken issuer would.
 */

import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_JWKS_URL,
  GOOGLE_TOKEN_URL,
} from '../../server/lib/app-auth/google-identity'

export interface FakeGoogleProfile {
  email?: string | null
  emailVerified?: boolean
  name?: string
  sub: string
}

export interface FakeGoogleTamper {
  aud?: string
  /** Seconds from now; negative mints an already expired token. */
  expiresIn?: number
  iss?: string
  nonce?: string
}

interface IssuedCode {
  challenge: string
  clientId: string
  nonce: string
  profile: FakeGoogleProfile
  redirectUri: string
  tamper: FakeGoogleTamper
}

export const FAKE_GOOGLE_KID = 'fake-google-key'

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
    'base64url',
  )
}

export async function createFakeGoogleIssuer(client: { clientId: string; clientSecret: string }) {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const publicJwk = {
    alg: 'RS256',
    e: exported.e!,
    kid: FAKE_GOOGLE_KID,
    kty: 'RSA',
    n: exported.n!,
    use: 'sig',
  }
  const codes = new Map<string, IssuedCode>()
  const calls = { jwks: 0, token: 0 }

  async function signIdToken(payload: Record<string, unknown>): Promise<string> {
    const input = `${base64Url(Buffer.from(JSON.stringify({ alg: 'RS256', kid: FAKE_GOOGLE_KID, typ: 'JWT' })))}.${base64Url(Buffer.from(JSON.stringify(payload)))}`
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(input),
    )
    return `${input}.${base64Url(signature)}`
  }

  /**
   * The user consents on Google's screen: Google redirects back with a code
   * and the `state` it was given. Returns that redirect's query.
   */
  function authorize(
    authorizeUrl: string,
    profile: FakeGoogleProfile,
    tamper: FakeGoogleTamper = {},
  ): { code: string; state: string } {
    const url = new URL(authorizeUrl)
    if (`${url.origin}${url.pathname}` !== GOOGLE_AUTHORIZE_URL) {
      throw new Error(`not Google's authorize endpoint: ${authorizeUrl}`)
    }
    const param = (name: string) => {
      const value = url.searchParams.get(name)
      if (!value) throw new Error(`authorize request has no ${name}`)
      return value
    }
    if (param('response_type') !== 'code') throw new Error('response_type must be code')
    if (param('code_challenge_method') !== 'S256') throw new Error('PKCE must be S256')
    if (!param('scope').split(' ').includes('openid')) throw new Error('scope must include openid')
    const code = `fake-code-${crypto.randomUUID()}`
    codes.set(code, {
      challenge: param('code_challenge'),
      clientId: param('client_id'),
      nonce: param('nonce'),
      profile,
      redirectUri: param('redirect_uri'),
      tamper,
    })
    return { code, state: param('state') }
  }

  async function token(body: URLSearchParams): Promise<Response> {
    const refuse = (error: string) =>
      new Response(JSON.stringify({ error }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    if (body.get('grant_type') !== 'authorization_code') return refuse('unsupported_grant_type')
    if (
      body.get('client_id') !== client.clientId ||
      body.get('client_secret') !== client.clientSecret
    ) {
      return refuse('invalid_client')
    }
    const issued = codes.get(body.get('code') ?? '')
    // Single use, like Google: a replayed code is invalid_grant.
    codes.delete(body.get('code') ?? '')
    if (!issued || issued.clientId !== client.clientId) return refuse('invalid_grant')
    if (issued.redirectUri !== body.get('redirect_uri')) return refuse('invalid_grant')
    const verifier = body.get('code_verifier') ?? ''
    const challenge = base64Url(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    )
    if (challenge !== issued.challenge) return refuse('invalid_grant')

    const now = Math.floor(Date.now() / 1000)
    const { profile, tamper } = issued
    const idToken = await signIdToken({
      iss: tamper.iss ?? 'https://accounts.google.com',
      aud: tamper.aud ?? client.clientId,
      azp: client.clientId,
      sub: profile.sub,
      ...(profile.email === null ? {} : { email: profile.email ?? `${profile.sub}@gmail.test` }),
      email_verified: profile.emailVerified ?? true,
      ...(profile.name ? { name: profile.name } : {}),
      iat: now,
      exp: now + (tamper.expiresIn ?? 3600),
      nonce: tamper.nonce ?? issued.nonce,
    })
    return new Response(
      JSON.stringify({ access_token: 'fake', expires_in: 3599, id_token: idToken }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  /** Install with `vi.stubGlobal('fetch', issuer.fetch)`. Anything else is refused. */
  async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === GOOGLE_JWKS_URL) {
      calls.jwks += 1
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    }
    if (url === GOOGLE_TOKEN_URL && init?.method === 'POST') {
      calls.token += 1
      return token(new URLSearchParams(String(init.body ?? '')))
    }
    throw new Error(`the fake Google issuer does not serve ${url}`)
  }

  return { authorize, calls, fetch, publicJwk, signIdToken }
}

export type FakeGoogleIssuer = Awaited<ReturnType<typeof createFakeGoogleIssuer>>
