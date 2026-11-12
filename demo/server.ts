/**
 * Demo: a fictional bank page protected by agent-detect.
 *   npm run build && npm run demo  →  http://localhost:8787
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextHash, createAgentDetect, TRUSTED_TYPES_REPORT_ONLY } from '../src/server/index';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** The demo's stand-in for a signed-in app session: an HttpOnly cookie. A real app uses its own session id. */
const appSession = (req: http.IncomingMessage) => /(?:^|;\s*)demo_sid=([a-f0-9]{32})/.exec(String(req.headers.cookie || ''))?.[1] ?? null;

export function startDemo(port = Number(process.env.PORT) || 8787) {
  // Capture mode (npm run demo:capture): every decision is printed and saved with the session's raw
  // trace, so real sessions can be inspected and re-scored later (npm run replay). Timing and geometry
  // only, like everything the collector sends. The folder is git-ignored: never commit real people's sessions.
  //   http://127.0.0.1:8787/?fresh=1&label=trackpad-normal   → a new session, saved under that label
  const captureDir = process.env.AD_CAPTURE_DIR;
  if (captureDir) mkdirSync(captureDir, { recursive: true });
  const labels = new Map<string, string>(); // detection session id → label given in the page URL
  let pendingLabel = process.env.AD_CAPTURE_LABEL || '';
  const ad = createAgentDetect({
    secret: process.env.AD_SECRET || 'demo-secret-change-me-0123456789',
    policy: { view_balance: 'low', update_profile: 'medium', transfer: 'high', add_payee: 'high', login: 'medium', wire: 'critical' },
    bind: appSession,    // one detection session per app session; tokens only work in the session that earned them
    exposeReasons: true, // demo only
    debug: true,         // demo only
    // AD_EXPERIMENTAL=mot.teleport_press,key.instant_delivery (or "all") turns on rules that are off by default
    scoreConfig: { experimental: (process.env.AD_EXPERIMENTAL || '').split(',').filter(Boolean) },
    onDecision: (e) => {
      if (!captureDir) return;
      console.log(`[decision] ${e.action} → ${e.decision}   verdict=${e.verdict} score=${e.score} scope=${e.scope} hits=[${e.hits.join(', ')}]`);
      const s = e.sid ? ad._session(e.sid) : undefined;
      const at = new Date().toISOString();
      if (e.sid && !labels.has(e.sid)) labels.set(e.sid, pendingLabel);
      const label = (e.sid && labels.get(e.sid)) || '';
      const file = join(captureDir, `${at.replace(/[:.]/g, '-')}-${label ? label + '-' : ''}${e.action}-${e.decision}.json`);
      writeFileSync(file, JSON.stringify({ at, label, event: e, trace: s?.trace ?? null }));
    },
  });

  const server = http.createServer(async (req, res) => {
    if (await ad.handle(req, res)) return;
    const url = new URL(req.url || '/', 'http://x');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy-report-only': TRUSTED_TYPES_REPORT_ONLY };
        // ?fresh=1 starts a new app session (and so a new detection session); ?label= names the capture.
        const label = (url.searchParams.get('label') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
        if (label) pendingLabel = label;
        if (!appSession(req) || url.searchParams.has('fresh')) headers['set-cookie'] = `demo_sid=${randomBytes(16).toString('hex')}; HttpOnly; SameSite=Strict; Path=/`;
        res.writeHead(200, headers);
        res.end(await readFile(join(here, 'index.html')));
        return;
      }
      if (url.pathname === '/agent-detect.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(await readFile(join(root, 'dist', 'agent-detect.iife.js')));
        return;
      }
      // The bank's own API. It recomputes the transaction context from the request it is about to execute,
      // and only proceeds on a token that is authentic, fresh, unused, for this action, this transaction and this app session.
      if (req.method === 'POST' && url.pathname === '/api/transfer') {
        const chunks: Buffer[] = [];
        for await (const c of req) { chunks.push(c as Buffer); if (chunks.length > 64) break; }
        let body: { payee?: unknown; amount?: unknown } = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* treated as empty */ }
        const ctx = contextHash(String(body.payee ?? ''), String(body.amount ?? ''), 'USD');
        const a = ad.authorize(String(req.headers['x-agent-detect'] || ''), { action: 'transfer', ctx, req });
        // A `step_up` token would pass only with `stepUpVerified: true`, set after verifying a passkey assertion (not built in this demo).
        res.writeHead(a.ok ? 200 : 403, { 'content-type': 'application/json' });
        res.end(JSON.stringify(a.ok ? { status: 'sent' } : { status: 'refused', reason: a.reason }));
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
