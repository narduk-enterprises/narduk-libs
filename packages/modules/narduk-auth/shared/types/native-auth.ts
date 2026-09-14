export interface NativeAuthClient {
  id: string
  name: string
  redirectUris: string[]
}

export interface NativeAuthorizationRequest {
  clientId: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  redirectUri: string
  state: string
}

export interface NativeTokenResponse {
  accessToken: string
  expiresIn: number
  refreshExpiresAt: number
  refreshToken: string
  sessionId: string
  tokenType: 'Bearer'
}
