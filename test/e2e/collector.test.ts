/**
 * Collector tests in a real browser (Chromium via Playwright) against the real server module.
 * Run: npm run test:browser   (builds first)
 *
 * These pin what the collector must and must not put on the wire. The driver is automation, so
 * nothing here says anything about verdicts on humans — only about the collector's behaviour.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { contextHash, createAgentDetect, TRUSTED_TYPES_REPORT_ONLY } from '../../src/server/index';
import { launchOptions } from './launch';

const PAGE = `<!doctype html><html><body>
<div id="app">
  <button id="go" style="width:140px;height:40px">Go</button>
  <select id="payee" style="width:200px;height:40px"><option>Choose</option><option>A</option><option>B</option></select>
  <input id="amount" autocomplete="off">
  <input id="user" autocomplete="username"><input id="pw" type="password">
  <div id="pin" data-ad-mask style="margin-top:300px">
    <button id="d1" style="width:60px;height:60px">1</button><button id="d2" style="width:60px;height:60px">2</button>
    <input id="pinfield">
  </div>
  <div id="own"></div>
</div>
<script src="/agent-detect.js"></script>
<script>
  // the app's own legacy code uses innerHTML a lot (reports as 'page')
  for (let i = 0; i < 80; i++) document.getElementById('own').innerHTML = '<i>' + i + '</i>';
  window.__ad = AgentDetect.AgentDetect.init({ endpoint: '/ad', flushMs: 600000 });
</script></body></html>`;

let browser: Browser;
let server: http.Server;
let url = '';
const ad = createAgentDetect({ secret: 'collector-test-secret-0123456789abcdef', policy: { transfer: 'high' } });

before(async () => {
  server = http.createServer(async (req, res) => {
    if (await ad.handle(req, res)) return;
    if (req.url === '/agent-detect.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile('dist/agent-detect.iife.js')); return; }
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy-report-only': TRUSTED_TYPES_REPORT_ONLY });
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch(launchOptions());
});

after(async () => { await browser?.close(); ad.close(); server?.close(); });

async function open(opts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page; trace: () => Promise<NonNullable<ReturnType<typeof ad._session>>['trace']> }> {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ad?.sessionId);
  const trace = async () => {
    await page.evaluate(() => (window as any).__ad.flush());
    const sid = await page.evaluate(() => (window as any).__ad.sessionId);
    return ad._session(sid)!.trace;
  };
  return { ctx, page, trace };
}

test('the /session call reports the collector clock, so the server can place this page load on its timeline', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bodies: any[] = [];
  page.on('request', (r) => { if (r.url().endsWith('/ad/session')) bodies.push(r.postDataJSON()); });
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ad?.sessionId);
  assert.equal(typeof bodies[0].ct, 'number');
  assert.ok(bodies[0].ct >= 0 && bodies[0].ct < 5000);
  await ctx.close();
});

test('touch taps: the compatibility mouse events are tagged as touch', async () => {
  const { ctx, page, trace } = await open({ hasTouch: true });
  for (let i = 0; i < 3; i++) { await page.touchscreen.tap(80, 30); await page.waitForTimeout(120); }
  const tr = await trace();
  assert.ok(tr.click.length >= 3, 'taps produced clicks');
  assert.ok(tr.btn.length >= 2, 'fixture: the browser emitted compatibility mouse events');
  assert.ok(tr.btn.every((b) => b.pt === 'touch'), JSON.stringify(tr.btn.slice(0, 4)));
  await ctx.close();
});

test('presses on a native <select> are not recorded as button holds (a real person gets a 0 ms press/release pair there)', async () => {
  const { ctx, page, trace } = await open();
  const sel = (await page.locator('#payee').boundingBox())!, go = (await page.locator('#go').boundingBox())!;
  await page.mouse.move(go.x + 30, go.y + 20, { steps: 4 });
  await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.mouse.move(sel.x + 40, sel.y + 20, { steps: 4 });
  await page.mouse.down(); await page.mouse.up();
  await page.keyboard.press('Escape');
  const tr = await trace();
  assert.equal(tr.btn.length, 2, `only the button press is a hold: ${JSON.stringify(tr.btn)}`);
  assert.ok(tr.btn[1].t - tr.btn[0].t >= 60);
  await ctx.close();
});

test('script-dispatched events are tagged by field class: credential fields (password managers) vs ordinary fields', async () => {
  const { ctx, page, trace } = await open();
  await page.evaluate(() => {
    const pw = document.getElementById('pw') as HTMLInputElement;
    pw.click(); pw.value = 'x';
    pw.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    const user = document.getElementById('user') as HTMLInputElement;
    user.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let tr = await trace();
  const untrusted = [...tr.click, ...tr.key, ...tr.input].filter((e) => e.tr === 0);
  assert.equal(untrusted.length, 4);
  assert.ok(untrusted.every((e) => e.af === 1), 'credential-field script events carry af');
  const sid = await page.evaluate(() => (window as any).__ad.sessionId);
  assert.ok(!ad.evaluate(sid, 'transfer').hits.some((h) => h.id === 'evt.untrusted'));

  await page.evaluate(() => document.getElementById('amount')!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })));
  tr = await trace();
  assert.equal(tr.input.filter((e) => e.tr === 0 && e.af !== 1).length, 1, 'a script event on the amount field is not exempt');
  assert.ok(ad.evaluate(sid, 'transfer').hits.some((h) => h.id === 'evt.untrusted'));
  await ctx.close();
});

test('masked region (PIN pad): no click geometry, no pointer path, no key timing leaves the browser', async () => {
  const { ctx, page, trace } = await open();
  const box = (await page.locator('#pin').boundingBox())!;
  const d1 = (await page.locator('#d1').boundingBox())!, d2 = (await page.locator('#d2').boundingBox())!;
  await page.mouse.move(50, 20, { steps: 5 });
  await page.mouse.move(d1.x + 20, d1.y + 25, { steps: 12 });
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.move(d2.x + 33, d2.y + 31, { steps: 8 });
  await page.mouse.down(); await page.mouse.up();
  await page.click('#pinfield');
  await page.keyboard.type('4821', { delay: 30 });
  const tr = await trace();
  const masked = tr.click.filter((c) => c.mk === 1);
  assert.equal(masked.length, 3);
  assert.ok(masked.every((c) => c.x === 0 && c.y === 0 && c.dx === 0 && c.dy === 0 && c.w === 0 && c.h === 0));
  const inside = tr.ptr.filter((p) => p.y >= box.y && p.y <= box.y + box.height && p.x >= box.x && p.x <= box.x + box.width);
  assert.equal(inside.length, 0, `${inside.length} pointer samples recorded inside the masked region`);
  assert.equal(tr.key.length, 0, 'key timing inside a masked region is not recorded');
  assert.ok(tr.ptr.length >= 5, 'pointer path outside the mask is still recorded');
  await ctx.close();
});

test('a mask hides what a person does, not what a script does: untrusted events inside it are still recorded', async () => {
  const { ctx, page, trace } = await open();
  await page.evaluate(() => {
    const f = document.getElementById('pinfield')!;
    f.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '4' }));
    f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  const tr = await trace();
  assert.equal(tr.key.filter((k) => k.tr === 0).length, 1, 'script key event in a masked field is recorded');
  assert.equal(tr.input.filter((i) => i.tr === 0).length, 1, 'script input event in a masked field is recorded');
  const sid = await page.evaluate(() => (window as any).__ad.sessionId);
  assert.ok(ad.evaluate(sid, 'transfer').hits.some((h) => h.id === 'evt.untrusted'), 'so evt.untrusted still fires');
  await ctx.close();
});

test("a field's autofill class is fixed when the page first shows it: retagging it later does not exempt script fills", async () => {
  const { ctx, page, trace } = await open();
  await page.waitForTimeout(300);                    // let the collector's background field scan run
  await page.evaluate(() => {
    const amount = document.getElementById('amount')!;
    amount.setAttribute('autocomplete', 'username');  // what an in-page agent would do before filling it
    amount.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  let tr = await trace();
  const amountEv = tr.input.filter((i) => i.tr === 0);
  assert.equal(amountEv.length, 1);
  assert.notEqual(amountEv[0].af, 1, 'the amount field was not an autofill field when first seen');
  // a credential field the app adds later is classified when it is inserted
  await page.evaluate(() => {
    const i = document.createElement('input'); i.id = 'late-pw'; i.type = 'password';
    document.getElementById('app')!.appendChild(i);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const i = document.getElementById('late-pw') as HTMLInputElement;
    i.type = 'text';                                  // show-password toggle: still the same credential field
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  tr = await trace();
  assert.equal(tr.input.filter((i) => i.tr === 0 && i.af === 1).length, 1, 'the late-inserted password field keeps its class');
  await ctx.close();
});

test('one printable keydown pays for one insertText: text injected after a real key is still keyless', async () => {
  const { ctx, page, trace } = await open();
  await page.click('#amount');
  await page.keyboard.press('1');
  await page.keyboard.insertText('250.00');          // CDP Input.insertText right after a real keydown
  await page.keyboard.press('Shift');
  await page.keyboard.insertText('99');              // a modifier key does not pay for text either
  const tr = await trace();
  const ins = tr.input.filter((i) => i.it === 'insertText');
  assert.equal(ins.length, 3);
  assert.ok(ins[0].kd >= 0 && ins[0].kd < 500, 'the typed character has its keydown');
  assert.equal(ins[1].kd, -1);
  assert.equal(ins[2].kd, -1);
  await ctx.close();
});

test("the page's own innerHTML use does not consume the injection-report budget or get shipped", async () => {
  const { ctx, page, trace } = await open();
  await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<b>agent overlay</b>'; document.body.appendChild(d); });
  await page.waitForTimeout(100);
  const tr = await trace();
  const sinks = tr.dom.filter((d) => d.kind === 'script-sink');
  assert.ok(sinks.some((d) => d.by === 'none'), 'the DevTools-Protocol injection is still reported after 80 page-origin violations');
  assert.equal(sinks.filter((d) => d.by === 'page').length, 0);
  await ctx.close();
});

test('flushes are serialised: a slow batch is never overtaken (no 409, no lost evidence)', async () => {
  const { ctx, page } = await open();
  const statuses: number[] = [];
  let first = true;
  await page.route('**/ad/collect', async (route) => {
    if (first) { first = false; await new Promise((r) => setTimeout(r, 400)); }
    await route.continue();
  });
  page.on('response', (r) => { if (r.url().endsWith('/ad/collect')) statuses.push(r.status()); });
  await page.mouse.move(100, 100, { steps: 5 });
  await page.evaluate(async () => {
    const a = (window as any).__ad;
    const p1 = a.flush();
    await new Promise((r) => setTimeout(r, 60));       // batch 1 is now on the wire (held back 400 ms by the route)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5 }));
    const p2 = a.flush();                              // batch 2 must wait for batch 1
    await Promise.all([p1, p2]);
  });
  for (let i = 0; i < 40 && statuses.length < 2; i++) await page.waitForTimeout(50); // response events trail the page's own promises
  assert.ok(statuses.length >= 2, `saw ${statuses.length} collect responses`);
  assert.ok(statuses.every((s) => s === 200), `statuses: ${statuses}`);
  await ctx.close();
});

test('the collector re-opens its session when the server no longer accepts it', async () => {
  const { ctx, page, trace } = await open();
  const sid = await page.evaluate(() => (window as any).__ad.sessionId);
  ad._session(sid)!.nonce = 'rotated-by-another-page-load';
  await page.mouse.move(60, 60, { steps: 4 });
  await page.evaluate(() => (window as any).__ad.flush());          // rejected (403) → re-open
  await page.click('#go');
  const tr = await trace();
  assert.ok(tr.click.length >= 1, 'events after the re-open reach the server');
  await ctx.close();
});

test('decide() fails closed in the page when the server is unreachable or errors', async () => {
  const { ctx, page } = await open();
  await page.route('**/ad/decide', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  assert.equal((await page.evaluate(() => (window as any).__ad.decide('transfer'))).decision, 'step_up');
  await page.unroute('**/ad/decide');
  await page.route('**/ad/decide', (route) => route.abort());
  assert.equal((await page.evaluate(() => (window as any).__ad.decide('transfer'))).decision, 'step_up');
  await ctx.close();
});

test('decide(action, ctx) binds the token to the transaction; contextHash matches the server', async () => {
  const { ctx, page } = await open();
  const want = contextHash('payee-2290', '250.00', 'USD');
  const got = await page.evaluate(() => (window as any).AgentDetect.AgentDetect.contextHash('payee-2290', '250.00', 'USD'));
  assert.equal(got, want);
  const d = await page.evaluate((c) => (window as any).__ad.decide('transfer', c), want);
  assert.equal(ad.verifyToken(d.token)!.ctx, want);
  await ctx.close();
});

test('the honeypot field tells the common password managers to skip it', async () => {
  const { ctx, page } = await open();
  const attrs = await page.evaluate(() => {
    const f = (window as any).AgentDetect.AgentDetect.canaryField();
    return ['data-1p-ignore', 'data-lpignore', 'data-bwignore', 'data-form-type'].map((a) => f.getAttribute(a));
  });
  assert.ok(attrs.every((a) => a !== null), JSON.stringify(attrs));
  await ctx.close();
});
