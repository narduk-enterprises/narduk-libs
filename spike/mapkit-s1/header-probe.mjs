// Validates PLAN 4.4 spec point 2 empirically: which headers a browser actually sends
// on a same-origin token GET, a cross-site token GET, and a top-level tab navigation.
import http from 'node:http';
import { chromium } from 'playwright';

const seen = [];
const mk = (host, port) =>
  new Promise((res) => {
    const s = http.createServer((req, r) => {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (u.pathname === '/api/token') {
        seen.push({
          server: `${host}:${port}`,
          label: u.searchParams.get('label'),
          method: req.method,
          host: req.headers.host,
          origin: req.headers.origin ?? null,
          referer: req.headers.referer ?? null,
          'sec-fetch-site': req.headers['sec-fetch-site'] ?? null,
          'sec-fetch-mode': req.headers['sec-fetch-mode'] ?? null,
          'sec-fetch-dest': req.headers['sec-fetch-dest'] ?? null,
        });
        r.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        return r.end('{"token":"fake"}');
      }
      r.writeHead(200, { 'content-type': 'text/html' });
      r.end('<!doctype html><title>probe</title><body>probe</body>');
    });
    s.listen(port, host, () => res(s));
  });

const A = await mk('localhost', 4541);
const B = await mk('127.0.0.1', 4542);
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto('http://localhost:4541/');
await page.evaluate(() => fetch('/api/token?label=same-origin-relative', { cache: 'no-store' }).then((r) => r.json()));
await page.evaluate(() => fetch('http://localhost:4541/api/token?label=same-origin-absolute').then((r) => r.json()));
await page.evaluate(() => fetch('http://127.0.0.1:4542/api/token?label=cross-site-from-A').then((r) => r.json()));
// Top-level navigation: a person pasting the token URL into a tab.
await page.goto('http://localhost:4541/api/token?label=top-level-navigation');

console.log(JSON.stringify(seen, null, 2));
await browser.close();
A.close();
B.close();
process.exit(0);
