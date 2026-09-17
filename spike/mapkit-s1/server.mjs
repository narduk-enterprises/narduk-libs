// MapKit S1 spike: two-origin static server + in-process MapKit JS token minting.
// Secrets are read from the environment (injected by `nvault run`) and NEVER written
// to disk, logged, or returned anywhere except the token response body.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOADER = fs.readFileSync(
  path.join(HERE, 'node_modules/@apple/mapkit-loader/dist/esm/index.js'),
  'utf8',
);

const TEAM_ID = process.env.APPLE_TEAM_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY;
if (!TEAM_ID || !KEY_ID || !PRIVATE_KEY) {
  console.error('MISSING SIGNING CONFIG (names only): APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY');
  process.exit(2);
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** Mint a MapKit JS token. `origin` null => no origin claim at all. */
export function mintToken({ origin, ttlSeconds = 1800, iatOffset = 0 }) {
  const iat = Math.floor(Date.now() / 1000) + iatOffset;
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: TEAM_ID, iat, exp: iat + ttlSeconds };
  if (origin) payload.origin = origin;
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: PRIVATE_KEY.includes('\\n') ? PRIVATE_KEY.replace(/\\n/g, '\n') : PRIVATE_KEY,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64u(sig)}`;
}

const PAGE = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8');

export function startServer({ host, port, csp, tokenPlan, redirectTokenTo }) {
  // tokenPlan: () => { origin: string|null, ttlSeconds: number }  (called per /api/token hit)
  const state = { tokenRequests: 0, cspReports: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/mapkit-loader.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      return res.end(LOADER);
    }
    if (url.pathname === '/api/token') {
      if (redirectTokenTo) {
        // Emulates narduk-core's 00-canonical-host middleware: 308 to the canonical origin,
        // with no /api exemption.
        res.writeHead(308, { location: `${redirectTokenTo}/api/token` });
        return res.end();
      }
      state.tokenRequests += 1;
      const plan = tokenPlan(state.tokenRequests);
      const token = mintToken(plan);
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        vary: 'origin, sec-fetch-site',
      });
      return res.end(JSON.stringify({ token, n: state.tokenRequests }));
    }
    if (url.pathname === '/csp-report') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        state.cspReports.push(body.slice(0, 2000));
        res.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
      if (csp) headers['content-security-policy'] = csp.replace(/\{\{nonce\}\}/g, NONCE);
      res.writeHead(200, headers);
      return res.end(PAGE.replace(/\{\{nonce\}\}/g, NONCE));
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, state, origin: `http://${host}:${port}` }));
  });
}

export const NONCE = 'n0nc3TESTn0nc3TESTn0nc3T';
