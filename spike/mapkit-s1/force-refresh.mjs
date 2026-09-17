// Q-C: force MapKit to need new credentials by 401-ing its tile/service requests after init,
// and observe whether authorizationCallback is invoked a second time.
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const HOST = 'localhost';
const PORT = Number(process.env.PORT || 4551);
const { server, state, origin } = await startServer({
  host: HOST,
  port: PORT,
  csp: null,
  tokenPlan: () => ({ origin: `http://${HOST}:${PORT}`, ttlSeconds: 1800 }),
});

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const bootstraps = [];
page.on('response', (r) => {
  if (r.url().includes('/ma/bootstrap')) bootstraps.push(r.status());
});

await page.goto(`${origin}/?scenario=forceRefresh&authCallback=1&keepalive=1`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForFunction(() => window.__spike?.loaded === true, null, { timeout: 30000 });
const afterInit = await page.evaluate(() => window.__spike.tokenCalls);

// Now make every credentialed data request fail auth.
await page.route('**/md/v1/**', (route) => route.fulfill({ status: 401, body: '' }));
await page.evaluate(() => {
  const m = window.__map;
  for (let i = 0; i < 6; i += 1) {
    setTimeout(() => {
      m.setCenterAnimated(new window.mapkit.Coordinate(37.33 + i * 0.05, -122.0 - i * 0.05), false);
    }, i * 4000);
  }
});
await page.waitForFunction(() => window.__spike.tokenCalls >= 2, null, { timeout: 60000 }).catch(() => {});

const spike = await page.evaluate(() => window.__spike);
console.log(
  JSON.stringify(
    {
      tokenCallsAfterInit: afterInit,
      tokenCallsFinal: spike.tokenCalls,
      serverTokenRequests: state.tokenRequests,
      configChanges: spike.configChanges,
      mapkitErrors: spike.mapkitErrors,
      bootstrapStatuses: bootstraps,
    },
    null,
    2,
  ),
);
await browser.close();
server.close();
process.exit(0);
