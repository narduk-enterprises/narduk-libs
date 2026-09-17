// MapKit S1 spike runner. Usage: nvault run -p apple -e prd -c mapkit-signing -- node run.mjs <scenario>
import { chromium, webkit } from 'playwright';
import fs from 'node:fs';
import { startServer } from './server.mjs';

const scenario = process.argv[2] || 'A';
const ttl = Number(process.env.SPIKE_TTL || 1800);

// narduk-core-style strict nonce CSP, plus the MapKit additions under test.
const CSP_PRESETS = {
  none: null,
  // Baseline: what a strict nonce-based preset looks like with NO MapKit allowances.
  strictBaseline: [
    "default-src 'self'",
    "script-src 'self' 'nonce-{{nonce}}' 'strict-dynamic'",
    "style-src 'self' 'nonce-{{nonce}}'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join('; '),
  // EXACT narduk-core 2.1.0 preset as computed today (security-headers.ts BASELINE_ALLOWLIST + directiveSeed),
  // minus upgrade-insecure-requests (which cannot be exercised on an http: fixture).
  nardukCoreActual: [
    "default-src 'self'",
    "script-src 'self' 'nonce-{{nonce}}' 'strict-dynamic' https://*.googletagmanager.com https://us.i.posthog.com https://us-assets.i.posthog.com https://static.cloudflareinsights.com https://cdn.apple-mapkit.com",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://us.i.posthog.com https://us-assets.i.posthog.com https://*.apple-mapkit.com https://*.apple.com",
    "img-src 'self' data: https://*.apple-mapkit.com",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "frame-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  // narduk-core actual + only 'wasm-unsafe-eval'.
  nardukCorePlusWasm: [
    "default-src 'self'",
    "script-src 'self' 'nonce-{{nonce}}' 'strict-dynamic' 'wasm-unsafe-eval' https://*.googletagmanager.com https://us.i.posthog.com https://us-assets.i.posthog.com https://static.cloudflareinsights.com https://cdn.apple-mapkit.com",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://us.i.posthog.com https://us-assets.i.posthog.com https://*.apple-mapkit.com https://*.apple.com",
    "img-src 'self' data: https://*.apple-mapkit.com",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "frame-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  // narduk-core actual + wasm + blob: in img/child, to catch blob-backed raster paths.
  nardukCorePlusWasmBlob: [
    "default-src 'self'",
    "script-src 'self' 'nonce-{{nonce}}' 'strict-dynamic' 'wasm-unsafe-eval' https://cdn.apple-mapkit.com",
    "connect-src 'self' blob: https://*.apple-mapkit.com https://*.apple.com",
    "img-src 'self' data: blob: https://*.apple-mapkit.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' https://*.apple-mapkit.com",
    "frame-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  // Candidate MapKit-enabled policy (the answer we are trying to prove).
  mapkit: [
    "default-src 'self'",
    "script-src 'self' 'nonce-{{nonce}}' 'strict-dynamic' 'wasm-unsafe-eval'",
    "style-src 'self' 'nonce-{{nonce}}' 'unsafe-inline'",
    "img-src 'self' data: blob: https://cdn.apple-mapkit.com https://*.apple-mapkit.com",
    "connect-src 'self' blob: https://cdn.apple-mapkit.com https://*.apple-mapkit.com",
    "font-src 'self' https://cdn.apple-mapkit.com https://*.apple-mapkit.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join('; '),
  // Same as mapkit but WITHOUT strict-dynamic, to see whether explicit hosts are needed.
  mapkitNoStrictDynamic: [
    "default-src 'self'",
    "script-src 'self' 'nonce-{{nonce}}' 'wasm-unsafe-eval' https://cdn.apple-mapkit.com https://*.apple-mapkit.com",
    "style-src 'self' 'nonce-{{nonce}}' 'unsafe-inline'",
    "img-src 'self' data: blob: https://cdn.apple-mapkit.com https://*.apple-mapkit.com",
    "connect-src 'self' blob: https://cdn.apple-mapkit.com https://*.apple-mapkit.com",
    "font-src 'self' https://cdn.apple-mapkit.com https://*.apple-mapkit.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join('; '),
};

const HOST_A = 'localhost';
const PORT_A = Number(process.env.SPIKE_PORT_A || 4501);
const HOST_B = '127.0.0.1';
const PORT_B = Number(process.env.SPIKE_PORT_B || 4502);
const ORIGIN_A = `http://${HOST_A}:${PORT_A}`;

const scenarios = {
  // Baseline: token for origin A, page on A, no CSP, 600 annotations.
  A: { host: HOST_A, port: PORT_A, csp: null, tokenOrigin: ORIGIN_A, query: 'annotations=600' },
  // THE BIG ONE: token minted for origin A, served to a page on origin B.
  B: { host: HOST_B, port: PORT_B, csp: null, tokenOrigin: ORIGIN_A, query: '' },
  // Control: token minted for origin B, used on origin B.
  Bown: { host: HOST_B, port: PORT_B, csp: null, tokenOrigin: `http://${HOST_B}:${PORT_B}`, query: '' },
  // Today's exposure: a token with NO origin claim, used on a foreign origin.
  noorigin: { host: HOST_B, port: PORT_B, csp: null, tokenOrigin: null, query: '' },
  // Port-sensitivity: token for :4501 used on :4502 of the SAME host name.
  portmismatch: { host: HOST_A, port: PORT_B, csp: null, tokenOrigin: ORIGIN_A, query: '' },
  // CSP probes.
  cspBaseline: { host: HOST_A, port: PORT_A, csp: 'strictBaseline', tokenOrigin: ORIGIN_A, query: '' },
  cspMapkit: { host: HOST_A, port: PORT_A, csp: 'mapkit', tokenOrigin: ORIGIN_A, query: 'annotations=600' },
  cspNoSD: { host: HOST_A, port: PORT_A, csp: 'mapkitNoStrictDynamic', tokenOrigin: ORIGIN_A, query: '' },
  cspCore: { host: HOST_A, port: PORT_A, csp: 'nardukCoreActual', tokenOrigin: ORIGIN_A, query: 'annotations=600' },
  cspCoreWasm: { host: HOST_A, port: PORT_A, csp: 'nardukCorePlusWasm', tokenOrigin: ORIGIN_A, query: 'annotations=600' },
  cspCoreWasmBlob: { host: HOST_A, port: PORT_A, csp: 'nardukCorePlusWasmBlob', tokenOrigin: ORIGIN_A, query: 'annotations=600' },
  cspCoreNoNonce: { host: HOST_A, port: PORT_A, csp: 'nardukCoreActual', tokenOrigin: ORIGIN_A, query: 'noNonce=1&annotations=600' },
  cspCoreSat: { host: HOST_A, port: PORT_A, csp: 'nardukCoreActual', tokenOrigin: ORIGIN_A, query: 'mapType=hybrid&threeD=1&annotations=50' },
  // O3: page served on a preview host whose /api/token is 308'd to the canonical host.
  canonicalRedirect: { host: HOST_B, port: PORT_B, csp: null, tokenOrigin: null, canonicalRedirect: true, query: '' },
  // Refresh wiring: authorizationCallback + short TTL.
  refresh: { host: HOST_A, port: PORT_A, csp: null, tokenOrigin: ORIGIN_A, query: 'authCallback=1', short: true },
  refreshLong: { host: HOST_A, port: PORT_A, csp: 'nardukCoreActual', tokenOrigin: ORIGIN_A, query: 'authCallback=1&annotations=600&keepalive=1', short: true },
  // Refresh wiring under the candidate CSP.
  refreshCsp: { host: HOST_A, port: PORT_A, csp: 'mapkit', tokenOrigin: ORIGIN_A, query: 'authCallback=1&annotations=600' },
};

const cfg = scenarios[scenario];
if (!cfg) {
  console.error('unknown scenario', scenario, Object.keys(scenarios));
  process.exit(2);
}

const ttlFor = cfg.short ? Number(process.env.SPIKE_SHORT_TTL || 70) : ttl;

// O3 probe: a canonical-host server that mints for ITSELF, plus a preview server that 308s to it.
let canonical = null;
if (cfg.canonicalRedirect) {
  canonical = await startServer({
    host: HOST_A,
    port: PORT_A,
    csp: null,
    tokenPlan: () => ({ origin: `http://${HOST_A}:${PORT_A}`, ttlSeconds: ttlFor }),
  });
}

const { server, state, origin } = await startServer({
  redirectTokenTo: cfg.canonicalRedirect ? `http://${HOST_A}:${PORT_A}` : undefined,
  host: cfg.host,
  port: cfg.port,
  csp: cfg.csp ? CSP_PRESETS[cfg.csp] : null,
  tokenPlan: () => ({ origin: cfg.tokenOrigin, ttlSeconds: ttlFor }),
});

const engine = process.env.SPIKE_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({
  args: process.env.SPIKE_BROWSER === 'webkit' ? [] : (process.env.SPIKE_GL === '1'
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
    : []),
  headless: process.env.SPIKE_HEADED === '1' ? false : true,
});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();

const net = [];
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('apple-mapkit.com') || u.includes('apple.com')) {
    const key = u.split('?')[0];
    const hit = net.find((n) => n.url === key && n.status === r.status());
    if (hit) hit.count += 1;
    else net.push({ status: r.status(), url: key, count: 1, firstQuery: (u.split('?')[1] || '').slice(0, 90) });
  }
});
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 300)));

const url = `${origin}/?scenario=${scenario}${cfg.query ? '&' + cfg.query : ''}`;
await page.goto(url, { waitUntil: 'domcontentloaded' });

const waitMs = Number(process.env.SPIKE_WAIT_MS || (cfg.short ? 120000 : 30000));
try {
  await page.waitForFunction(() => window.__spike && window.__spike.done === true, null, { timeout: waitMs - 5000 });
} catch {
  /* fall through and report whatever state we have */
}

if (cfg.short) {
  // Give MapKit time to notice the short expiry and ask for a second token.
  try {
    await page.waitForFunction(() => window.__spike && window.__spike.tokenCalls >= 2, null, { timeout: waitMs });
  } catch {
    /* recorded below as tokenCalls === 1 */
  }
}

await page.waitForTimeout(Number(process.env.SPIKE_SETTLE_MS || 0));
const spike = await page.evaluate(() => window.__spike);
const shot = `/tmp/mapkit-s1-${scenario}-${process.env.SPIKE_BROWSER || 'chromium'}${process.env.SPIKE_GL === '1' ? '-gl' : ''}.png`;
await page.screenshot({ path: shot });

const out = {
      scenario,
      pageOrigin: origin,
      tokenOriginClaim: cfg.tokenOrigin ?? '(none)',
      tokenTtlSeconds: ttlFor,
      csp: cfg.csp ? CSP_PRESETS[cfg.csp] : null,
      serverTokenRequests: state.tokenRequests,
      spike: {
        loaded: spike?.loaded,
        error: spike?.error,
        initMs: spike?.initMs,
        annotationsAdded: spike?.annotationsAdded,
        annotationMs: spike?.annotationMs,
        tokenCalls: spike?.tokenCalls,
        configChanges: spike?.configChanges,
        mapkitErrors: spike?.mapkitErrors,
        wasm: spike?.wasm,
        webgl: spike?.webgl,
        violations: spike?.violations,
      },
      appleNetwork: net,
      consoleErrors: consoleErrors.slice(0, 12),
      screenshot: shot,
};
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`./results/${scenario}-${process.env.SPIKE_BROWSER || 'chromium'}.json`, import.meta.url), JSON.stringify(out, null, 2));
const bad = net.filter((n) => n.status >= 300);
console.log(JSON.stringify({
  scenario, engine: process.env.SPIKE_BROWSER || 'chromium', pageOrigin: out.pageOrigin, tokenOriginClaim: out.tokenOriginClaim, tokenTtlSeconds: out.tokenTtlSeconds,
  serverTokenRequests: out.serverTokenRequests, canonicalTokenRequests: canonical ? canonical.state.tokenRequests : null, spike: out.spike,
  appleNonOk: bad, appleReqKinds: net.length, consoleErrors: out.consoleErrors, screenshot: shot,
}, null, 2));

await browser.close();
server.close();
if (canonical) canonical.server.close();
process.exit(0);
