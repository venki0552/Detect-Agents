/**
 * Demo: a fictional bank page protected by agent-detect.
 *   npm run build && npm run demo  →  http://localhost:8787
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentDetect, TRUSTED_TYPES_REPORT_ONLY } from '../src/server/index';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export function startDemo(port = Number(process.env.PORT) || 8787) {
  const ad = createAgentDetect({
    secret: process.env.AD_SECRET || 'demo-secret-change-me-0123456789',
    policy: { view_balance: 'low', update_profile: 'medium', transfer: 'high', add_payee: 'high', login: 'medium' },
    exposeReasons: true, // demo only
    debug: true,         // demo only
  });

  const server = http.createServer(async (req, res) => {
    if (await ad.handle(req, res)) return;
    const url = new URL(req.url || '/', 'http://x');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy-report-only': TRUSTED_TYPES_REPORT_ONLY });
        res.end(await readFile(join(here, 'index.html')));
        return;
      }
      if (url.pathname === '/agent-detect.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(await readFile(join(root, 'dist', 'agent-detect.iife.js')));
        return;
      }
      // the bank's own API: only honours a valid, fresh "allow" token
      if (req.method === 'POST' && url.pathname === '/api/transfer') {
        const token = String(req.headers['x-agent-detect'] || '');
        const p = ad.verifyToken(token);
        const ok = !!p && p.action === 'transfer' && p.decision === 'allow';
        res.writeHead(ok ? 200 : 403, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ok ? { status: 'sent' } : { status: 'refused', reason: p ? p.decision : 'missing or invalid token' }));
        return;
      }
    } catch (e) {
      res.writeHead(500); res.end(String(e)); return;
    }
    res.writeHead(404); res.end('not found');
  });

  return new Promise<{ server: http.Server; ad: ReturnType<typeof createAgentDetect>; url: string }>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, ad, url: `http://127.0.0.1:${port}` }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startDemo().then(({ url }) => console.log(`agent-detect demo on ${url}`));
}
