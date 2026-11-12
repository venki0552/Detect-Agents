import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
// Run from the repo root (npm run bench). CHROMIUM_PATH picks a specific browser binary.
const js = readFileSync(new URL('../dist/agent-detect.iife.js', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' });
const page = await browser.newPage();
await page.setContent(`<html><body><div id="app"><button id="b" style="width:120px;height:40px">Pay</button><input id="i"></div></body></html>`);
await page.addScriptTag({ content: js });
const r = await page.evaluate(async () => {
  const AD = (window).AgentDetect.AgentDetect;
  // Keys are dispatched on the <input>, moves on the button, so target-dependent work (mask and field checks) is measured too.
  const fire = (n, mk, target = window) => { const t = performance.now(); for (let i = 0; i < n; i++) target.dispatchEvent(mk(i)); return performance.now() - t; };
  const inp = document.getElementById('i');
  const mkMove = (i) => new PointerEvent('pointermove', { clientX: i % 800, clientY: i % 600, pointerType: 'mouse', bubbles: true });
  const mkKey = () => new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true });
  const btn = document.getElementById('b');
  const clickN = (n) => { const t = performance.now(); for (let i = 0; i < n; i++) btn.dispatchEvent(new PointerEvent('click', { clientX: 60, clientY: 20, pointerType: 'mouse', bubbles: true, detail: 1 })); return performance.now() - t; };
  const N = 5000;
  const base = { move: fire(N, mkMove), key: fire(N, mkKey, inp), click: clickN(1000) };
  const inits = [];
  let ad;
  // one instance only (each started instance adds its own listeners)
  { const t = performance.now(); ad = new AD({ canaries: false }); ad.start(); inits.push(performance.now() - t); }
  // environment checks now run at background priority; time how long until they land
  const tEnv = performance.now();
  await new Promise((r) => { const poll = () => (ad.localFeatures().env ? r() : setTimeout(poll, 5)); poll(); });
  const envReadyMs = performance.now() - tEnv;
  const withSdk = { move: fire(N, mkMove), key: fire(N, mkKey, inp), click: clickN(1000) };
  // fill the local trace to its cap, then time local scoring (debug-only path)
  fire(5000, mkMove);
  const scores = [];
  for (let k = 0; k < 5; k++) { const t = performance.now(); ad.localScore(); scores.push(performance.now() - t); }
  // serialize a 3-second batch worth of events (~200 moves)
  const batch = { ptr: Array.from({ length: 200 }, (_, i) => ({ t: i * 16, x: i, y: i, c: 3, tr: 1, pt: 'mouse' })) };
  let t = performance.now(); for (let k = 0; k < 100; k++) JSON.stringify(batch); const ser = (performance.now() - t) / 100;
  return {
    perMoveUs: ((withSdk.move - base.move) / N) * 1000,
    perKeyUs: ((withSdk.key - base.key) / N) * 1000,
    perClickUs: ((withSdk.click - base.click) / 1000) * 1000,
    initSyncMs: inits.map((x) => +x.toFixed(2)),
    envReadyAfterMs: +envReadyMs.toFixed(1),
    localScoreMs: scores.map((x) => +x.toFixed(1)),
    serializeBatchMs: +ser.toFixed(3),
    renderer: ad.localFeatures().env.renderer,
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
