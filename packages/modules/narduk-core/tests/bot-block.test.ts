import { createServer, request } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import botBlock from '../runtime/server/middleware/00-0-bot-block'
import {
  blockedBotNames,
  createBotMatcher,
  DEFAULT_BLOCKED_BOTS,
  resolveBotBlockOptions,
} from '../runtime/shared/bot-block'

const { runtime } = vi.hoisted(() => ({ runtime: { nardukBotBlock: undefined as unknown } }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

const HANDLER_RAN = 'handler-ran'

interface Probe {
  cacheControl: string | null
  status: number
  text: string
  vary: string | null
}

async function probe(path: string, userAgent: string | undefined, method = 'GET'): Promise<Probe> {
  const app = createApp()
    .use(botBlock)
    .use(() => HANDLER_RAN)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    return await new Promise<Probe>((resolve, reject) => {
      const req = request(
        {
          headers: userAgent === undefined ? {} : { 'user-agent': userAgent },
          host: '127.0.0.1',
          method,
          path,
          port: address.port,
        },
        (response) => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => (text += chunk))
          response.on('end', () =>
            resolve({
              cacheControl: (response.headers['cache-control'] as string | undefined) ?? null,
              status: response.statusCode ?? 0,
              text,
              vary: (response.headers.vary as string | undefined) ?? null,
            }),
          )
        },
      )
      req.on('error', reject)
      req.end()
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

const BLOCKED_USER_AGENTS = [
  'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
  'Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot; help@moz.com)',
  'Mozilla/5.0 (compatible; SERankingBacklinksBot/1.0; +https://seranking.com/backlink-crawler.html)',
  'Mozilla/5.0 (compatible; Barkrowler/0.9; +https://babbar.tech/crawler)',
  'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  'MochiImageCrawler/1.0',
  'Mozilla/5.0 (compatible; AionBot/1.0; +https://aion.example/bot)',
  'semrushbot',
]

const ALLOWED_USER_AGENTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Googlebot-Image/1.0',
  'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  'DuckDuckBot/1.1; (+http://duckduckgo.com/duckbot.html)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  'watchdog-uptime/1.0',
  'curl/8.7.1',
  'python-requests/2.32.3',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)',
  'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  '',
]

describe('bot-block middleware', () => {
  beforeEach(() => {
    runtime.nardukBotBlock = undefined
  })

  it.each(BLOCKED_USER_AGENTS)('answers 403 to %s without running the handler', async (ua) => {
    const result = await probe('/lakes/superior', ua)
    expect(result.status).toBe(403)
    expect(result.text).not.toContain(HANDLER_RAN)
    expect(result.text.length).toBeLessThan(120)
    expect(result.cacheControl).toBe('public, max-age=86400')
    expect(result.vary?.toLowerCase()).toContain('user-agent')
  })

  it.each(ALLOWED_USER_AGENTS)('passes %j through', async (ua) => {
    const result = await probe('/lakes/superior', ua)
    expect(result.status).toBe(200)
    expect(result.text).toBe(HANDLER_RAN)
  })

  it('passes a request with no User-Agent header', async () => {
    const result = await probe('/lakes/superior', undefined)
    expect(result.text).toBe(HANDLER_RAN)
  })

  it('blocks every method and API paths', async () => {
    expect((await probe('/api/lakes', BLOCKED_USER_AGENTS[0], 'HEAD')).status).toBe(403)
    expect((await probe('/api/lakes?x=1', BLOCKED_USER_AGENTS[0], 'POST')).status).toBe(403)
  })

  it('keeps /robots.txt and /api/health reachable for a blocked crawler', async () => {
    for (const path of ['/robots.txt', '/robots.txt?x=1', '/api/health']) {
      const result = await probe(path, BLOCKED_USER_AGENTS[0])
      expect(result.text, path).toBe(HANDLER_RAN)
    }
  })

  it('does not exempt look-alike paths', async () => {
    expect((await probe('/robots.txt/x', BLOCKED_USER_AGENTS[0])).status).toBe(403)
    expect((await probe('/api/health/deep', BLOCKED_USER_AGENTS[0])).status).toBe(403)
  })

  it('blocks `extra` names', async () => {
    runtime.nardukBotBlock = { enabled: true, extra: ['NewSeoSpider'], allow: [] }
    expect((await probe('/', 'Mozilla/5.0 (compatible; newseospider/2.0)')).status).toBe(403)
    expect((await probe('/', BLOCKED_USER_AGENTS[0])).status).toBe(403)
  })

  it('lets `allow` names through', async () => {
    runtime.nardukBotBlock = { enabled: true, extra: [], allow: ['AhrefsBot'] }
    expect((await probe('/', BLOCKED_USER_AGENTS[1])).text).toBe(HANDLER_RAN)
    expect((await probe('/', BLOCKED_USER_AGENTS[0])).status).toBe(403)
  })

  it('does nothing when disabled', async () => {
    runtime.nardukBotBlock = { enabled: false, extra: [], allow: [] }
    expect((await probe('/', BLOCKED_USER_AGENTS[0])).text).toBe(HANDLER_RAN)
  })

  it('treats a string "false" from an env override as disabled', async () => {
    runtime.nardukBotBlock = { enabled: 'false', extra: [], allow: [] }
    expect((await probe('/', BLOCKED_USER_AGENTS[0])).text).toBe(HANDLER_RAN)
  })

  it('falls back to the defaults when the runtime config is malformed', async () => {
    runtime.nardukBotBlock = { extra: 42 }
    expect((await probe('/', BLOCKED_USER_AGENTS[0])).status).toBe(403)
  })

  it('builds the matcher once while the runtime config is unchanged', async () => {
    const source = { enabled: true, extra: [], allow: [] }
    runtime.nardukBotBlock = source
    await probe('/', BLOCKED_USER_AGENTS[0])
    const frozen = Object.freeze({ ...source })
    // A different object is a different configuration: it is re-read.
    runtime.nardukBotBlock = { ...frozen, enabled: false }
    expect((await probe('/', BLOCKED_USER_AGENTS[0])).text).toBe(HANDLER_RAN)
  })
})

describe('bot-block list and options', () => {
  it('lists the agreed crawlers once each', () => {
    expect([...DEFAULT_BLOCKED_BOTS]).toEqual([
      'SemrushBot',
      'AhrefsBot',
      'MJ12bot',
      'DotBot',
      'SERankingBacklinksBot',
      'DataForSeoBot',
      'BLEXBot',
      'Barkrowler',
      'serpstatbot',
      'PetalBot',
      'Bytespider',
      'MochiImageCrawler',
      'SeekportBot',
      'MegaIndex',
      'Linkdex',
      'AwarioBot',
      'ImagesiftBot',
      'Timpibot',
      'AionBot',
    ])
  })

  it('never matches an allowed user agent with the defaults', () => {
    const matches = createBotMatcher(undefined)
    expect(ALLOWED_USER_AGENTS.filter((ua) => matches(ua))).toEqual([])
    expect(BLOCKED_USER_AGENTS.filter((ua) => !matches(ua))).toEqual([])
  })

  it('resolves booleans, strings and undefined', () => {
    expect(resolveBotBlockOptions(undefined)).toEqual({ allow: [], enabled: true, extra: [] })
    expect(resolveBotBlockOptions(true).enabled).toBe(true)
    expect(resolveBotBlockOptions(false).enabled).toBe(false)
    expect(resolveBotBlockOptions({ extra: 'a, b,a' }).extra).toEqual(['a', 'b'])
  })

  it('rejects a wrong shape at build time', () => {
    expect(() => resolveBotBlockOptions('yes')).toThrow(/botBlock/)
    expect(() => resolveBotBlockOptions({ extra: [1] })).toThrow(/botBlock\.extra/)
  })

  it('blockedBotNames applies extra, allow and enabled', () => {
    expect(blockedBotNames(undefined)).toEqual([...DEFAULT_BLOCKED_BOTS])
    expect(blockedBotNames(false)).toEqual([])
    expect(blockedBotNames({ enabled: false })).toEqual([])
    const names = blockedBotNames({ extra: ['Foo', 'semrushbot'], allow: ['dotbot'] })
    expect(names).toContain('Foo')
    expect(names).not.toContain('DotBot')
    expect(names.filter((name) => name.toLowerCase() === 'semrushbot')).toHaveLength(1)
  })
})
