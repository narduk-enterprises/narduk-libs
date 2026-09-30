/** `GET /api/auth/mcp/consent`: what the consent page renders next. */
export type McpOAuthConsentState =
  | { status: 'login' }
  | {
      account: { email: string; name: string | null }
      client: {
        /** Verified domain of a Client ID Metadata Document client. */
        domain?: string
        id: string
        /** Client-supplied: render as text, never as HTML. */
        name: string
        uri?: string
      }
      /** One-use, browser-bound transaction handle for the approve/deny POST. */
      handle: string
      /** Where the tokens go; the page must show it. */
      redirectHost: string
      /** The redirect is an app on this computer: the page should warn. */
      redirectIsLoopback: boolean
      resource: string
      scopes: string[]
      status: 'consent'
    }
  | {
      message: string
      /** Present only when the client and its redirect URI were validated. */
      redirectTo?: string
      status: 'error'
    }

/** `POST /api/auth/mcp/consent` body. */
export interface McpOAuthConsentDecision {
  decision: 'approve' | 'deny'
  handle: string
}

/** A connected app, as `GET /api/auth/mcp/grants` lists it. */
export interface McpOAuthConnectedApp {
  clientId: string
  clientName: string
  /** Unix seconds. */
  createdAt: number
  /** Unix seconds; unset when the grant does not expire on its own. */
  expiresAt?: number
  id: string
  scopes: string[]
}
