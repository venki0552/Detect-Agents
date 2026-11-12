import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path';
const ext = resolve('bench/ext-agent');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pw-')), { channel: 'chromium', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const page = await ctx.newPage();
await page.route('http://probe.test/', (r) => r.fulfill({ contentType: 'text/html',
  headers: { 'Content-Security-Policy-Report-Only': "require-trusted-types-for 'script'" },
  body: `<html><body><div id=app>bank</div><script>window.__viol=[];document.addEventListener('securitypolicyviolation',e=>window.__viol.push({d:e.violatedDirective,src:e.sourceFile,line:e.lineNumber,sample:(e.sample||'').slice(0,40)}));</script></body></html>` }));
await page.goto('http://probe.test/');
await page.waitForTimeout(1200);
await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<i>cdp</i>'; document.body.appendChild(d); });
console.log(JSON.stringify(await page.evaluate(() => ({ viol: window.__viol, iso: !!document.getElementById('iso-overlay'), main: !!document.getElementById('main-overlay') })), null, 1));
// keydown delivery latency distribution under CDP
await page.evaluate(() => { window.__lat = []; addEventListener('keydown', (e) => window.__lat.push(performance.now() - e.timeStamp), true); });
await page.keyboard.type('the quick brown fox jumps over the lazy dog', { delay: 40 });
const lat = await page.evaluate(() => window.__lat.map((x) => +x.toFixed(2)));
lat.sort((a, b) => a - b); console.log('CDP keydown latency ms: min', lat[0], 'median', lat[lat.length >> 1], 'max', lat[lat.length - 1], 'n', lat.length);
await ctx.close();
