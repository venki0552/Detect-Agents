// Empirical probe: which new browser signals distinguish CDP / script input?
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage();
await page.route('http://probe.test/', (r) => r.fulfill({
  contentType: 'text/html',
  headers: { 'Content-Security-Policy-Report-Only': "require-trusted-types-for 'script'" },
  body: `<html><body><form id=f><input id=a name=email autocomplete=email><input id=b><button id=s type=button style="width:120px;height:40px">Go</button></form>
  <script>
  window.__ev = []; window.__viol = []; window.__vis = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push({ name: e.name, iid: e.interactionId, delay: +(e.processingStart - e.startTime).toFixed(2), dur: e.duration }); })
    .observe({ type: 'event', buffered: true, durationThreshold: 16 });
  document.addEventListener('securitypolicyviolation', (e) => window.__viol.push(e.violatedDirective + ' ' + e.sample?.slice(0, 40)));
  window.__visEntries = () => performance.getEntriesByType('visibility-state').map((e) => e.name + '@' + Math.round(e.startTime));
  window.__lat = []; for (const t of ['pointerdown','click','keydown']) addEventListener(t, (e) => window.__lat.push(t + ':' + (performance.now() - e.timeStamp).toFixed(2)), true);
  </script></body></html>` }));
await page.goto('http://probe.test/');
// 1) CDP mouse + keyboard
await page.mouse.click(60, 60); await page.click('#s'); await page.keyboard.type('hello', { delay: 30 });
// 2) Playwright fill (CDP insertText) and :autofill state
await page.fill('#a', 'x@y.com');
const autofill = await page.evaluate(() => ({ a: document.querySelector('#a').matches(':autofill'), b: document.querySelector('#b').matches(':autofill') }));
// 3) script-dispatched click
await page.evaluate(() => document.querySelector('#s').click());
// 4) main-world DOM string sink via page.evaluate (CDP Runtime.evaluate)
await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<b>agent overlay</b>'; document.body.appendChild(d); });
// 5) init-script style injection (addScriptToEvaluateOnNewDocument)
await page.addInitScript(() => { window.__initRan = true; });
await page.waitForTimeout(400);
const out = await page.evaluate(() => ({ ev: window.__ev, viol: window.__viol, vis: window.__visEntries(), lat: window.__lat, hasVSE: 'VisibilityStateEntry' in window, webmcp: 'modelContext' in document, agentInvoked: 'agentInvoked' in SubmitEvent.prototype }));
console.log(JSON.stringify({ ...out, autofill }, null, 1));
await browser.close();
