import { initializeMapKit, resetMapKitClientStateForTests } from '../src/client/index.js'

function tokenWithExp(exp: number): string {
  const payload = btoa(JSON.stringify({ exp })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.sig`
}

describe('browser MapKit initialization', () => {
  afterEach(() => {
    resetMapKitClientStateForTests()
  })

  it('loads a dynamic token and registers mapkit authorization callback', async () => {
    const issuedTokens: string[] = []
    const mapkit = {
      init: vi.fn((options: { authorizationCallback(done: (token: string) => void): void }) => {
        options.authorizationCallback((token) => issuedTokens.push(token))
      }),
    }
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + 3600)

    await initializeMapKit({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token }))),
      mapkitGlobal: mapkit,
      tokenEndpoint: '/mapkit-token',
    })

    expect(mapkit.init).toHaveBeenCalledTimes(1)
    expect(issuedTokens).toEqual([token])
  })
})
