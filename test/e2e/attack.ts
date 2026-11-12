/**
 * Attack harness: drives the demo bank with real browser automation and
 * reports what the server decided. Run: npm run build && npm run attack
 *
 * Every scenario here is an AGENT. There is no human control in this file —
 * a CDP-driven "human" would still be CDP. Calibrate false positives on real
 * human sessions (README → Calibration).
 */
import { chromium, type Browser, type Page } from 'playwright';
import { startDemo } from '../../demo/server';
import { launchOptions } from './launch';

const REAL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uni = (a: number, b: number) => a + Math.random() * (b - a);

interface Outcome { scenario: string; decision: string; verdict: string; score: number; hits: { id: string; evidence: string }[]; env?: any; note?: string }

async function stealthBrowser(): Promise<Browser> {
  const headed = process.env.HEADED === '1';
  return chromium.launch(launchOptions({ headless: !headed, args: ['--disable-blink-features=AutomationControlled'] }));
}

async function open(browser: Browser, url: string, stealth: boolean): Promise<Page> {
  const ctx = await browser.newContext(stealth ? { userAgent: REAL_UA, viewport: { width: 1366, height: 768 }, screen: { width: 1920, height: 1080 } } : {});
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ad?.sessionId);
  return page;
}

async function center(page: Page, sel: string) {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

async function finish(page: Page, scenario: string, submit: () => Promise<void>, note?: string): Promise<Outcome> {
  await submit();
  await page.waitForFunction(() => (window as any).__lastDecision, null, { timeout: 15000 });
  const d = await page.evaluate(() => (window as any).__lastDecision);
  const env = await page.evaluate(() => (window as any).__ad.localFeatures().env);
  return { scenario, decision: d.decision, verdict: d.verdict, score: d.score, hits: d.reasons, env, note };
}

// ─────────────────────────────── scenarios ───────────────────────────────

/** A: stock Playwright, default headless, high-level API (click/fill/selectOption/type). */
async function stockPlaywright(url: string): Promise<Outcome> {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? launchOptions() : {});
  const page = await open(browser, url, false);
  await page.click('#viewBalance');
  await sleep(800);
  await page.selectOption('#payee', { index: 1 });
  await page.fill('#amount', '250.00');
  await page.fill('#when', '11/12/2026');
  await page.type('#memo', 'rent for november', { delay: 50 });
  const out = await finish(page, 'A. Stock Playwright (headless, click/fill/type)', () => page.click('#send'));
  await browser.close();
  return out;
}

/** B: stealth flags + xdotool-style input: frozen pointer, teleport, instant click, 12 ms typing. */
async function xdotoolStyle(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const page = await open(browser, url, true);
  const act = async (sel: string) => {
    await sleep(uni(2500, 4000)); // "model thinking", pointer frozen
    const c = await center(page, sel);
    await page.mouse.move(c.x + uni(-3, 3), c.y + uni(-2, 2)); // single jump
    await page.mouse.down(); await page.mouse.up();
  };
  await act('#viewBalance');
  await act('#amount'); await page.keyboard.type('250.00', { delay: 12 });
  await act('#when'); await page.keyboard.type('11/12/2026', { delay: 12 });
  await act('#memo'); await page.keyboard.type('rent for november', { delay: 12 });
  const out = await finish(page, 'B. Stealth + xdotool-style (teleport, 12 ms typing)', () => act('#send'));
  await browser.close();
  return out;
}

/** Humanized input driver: Bezier paths, eased timing, off-centre clicks, uniform random delays. */
async function humanizedFlow(page: Page, label: string): Promise<Outcome> {
  let pos = { x: 400, y: 300 };
  await page.mouse.move(pos.x, pos.y);
  const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
  const moveTo = async (tx: number, ty: number) => {
    const p0 = pos, p3 = { x: tx, y: ty };
    const p1 = { x: p0.x + uni(-120, 120), y: p0.y + uni(-120, 120) };
    const p2 = { x: p3.x + uni(-120, 120), y: p3.y + uni(-120, 120) };
    const steps = Math.round(uni(28, 45));
    for (let i = 1; i <= steps; i++) {
      const u = ease(i / steps), v = 1 - u;
      await page.mouse.move(
        v ** 3 * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u ** 3 * p3.x,
        v ** 3 * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u ** 3 * p3.y,
      );
      await sleep(16);
    }
    pos = p3;
  };
  const act = async (sel: string) => {
    await sleep(uni(2000, 4500));
    const c = await center(page, sel);
    await moveTo(c.x + uni(-c.w / 4, c.w / 4), c.y + uni(-c.h / 4, c.h / 4));
    await page.mouse.down(); await sleep(uni(60, 140)); await page.mouse.up();
  };
  const type = async (s: string) => {
    for (const ch of s) {
      await page.keyboard.down(ch); await sleep(uni(50, 120)); await page.keyboard.up(ch);
      await sleep(uni(40, 160));
    }
  };
  await act('#viewBalance');
  await act('#amount'); await type('250.00');
  await act('#when'); await type('11/12/2026');
  await act('#memo'); await type('rent for november and utilities');
  return finish(page, label, () => act('#send'));
}

/** C: stealth flags + humanized input. */
async function humanized(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const page = await open(browser, url, true);
  const out = await humanizedFlow(page, 'C. Stealth + humanized (Bezier, random delays)');
  await browser.close();
  return out;
}

/** G: humanized input + highlight overlay injected through the DevTools Protocol (main world, innerHTML). */
async function overlayViaCdp(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const page = await open(browser, url, true);
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<div style="position:fixed;inset:0;pointer-events:none;outline:2px dashed red">agent</div>';
    document.body.appendChild(d);
  });
  const out = await humanizedFlow(page, 'G. Humanized + overlay injected via DevTools Protocol');
  await browser.close();
  return out;
}

/** H: humanized input inside a browser with an agent-style extension drawing overlays (isolated + main world). */
async function extensionAgent(url: string): Promise<Outcome> {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const ext = resolve('test/e2e/ext-agent');
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ad-ext-')), {
    ...launchOptions(), headless: process.env.HEADED !== '1', userAgent: REAL_UA,
    viewport: { width: 1366, height: 768 }, screen: { width: 1920, height: 1080 },
    args: ['--disable-blink-features=AutomationControlled', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ad?.sessionId);
  const out = await humanizedFlow(page, 'H. Humanized + agent-style extension overlays');
  await ctx.close();
  return out;
}

/** D: an extension/content-script style agent: element.click() and value + dispatchEvent. */
async function scriptInjection(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const page = await open(browser, url, true);
  await page.evaluate(() => {
    (document.querySelector('#viewBalance') as HTMLElement).click();
    const a = document.querySelector('#amount') as HTMLInputElement;
    a.value = '999.00';
    a.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '999.00' }));
  });
  await sleep(500);
  const out = await finish(page, 'D. Script injection (element.click, dispatchEvent)', () =>
    page.evaluate(() => (document.querySelector('#transfer') as HTMLFormElement).requestSubmit()));
  await browser.close();
  return out;
}

/** E: DOM agent that fills every text field it finds, then clicks like a human-ish mouse. */
async function fillEverything(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const page = await open(browser, url, true);
  const inputs = await page.locator('input[type="text"], input:not([type])').all();
  for (const i of inputs) { try { await i.fill('250.00', { timeout: 1500 }); } catch { /* skip unfillable */ } }
  const out = await finish(page, 'E. Fill-every-field DOM agent', async () => {
    const c = await center(page, '#send');
    await page.mouse.move(c.x, c.y, { steps: 15 });
    await page.mouse.down(); await sleep(90); await page.mouse.up();
  });
  await browser.close();
  return out;
}

/** F: types into the bank tab while another tab is in front. */
async function backgroundTab(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const page = await open(browser, url, true);
  await page.click('#amount');
  const other = await page.context().newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const hidden = await page.evaluate(() => document.hidden);
  await page.keyboard.type('250.00', { delay: 90 });
  await page.bringToFront();
  const out = await finish(page, 'F. Typing into a background tab', () => page.click('#send'), `document.hidden during typing: ${hidden}`);
  await browser.close();
  return out;
}

/**
 * I: a blatantly robotic but SHORT session: two teleport clicks with 0 ms holds, text typed at 12 ms.
 * Too few samples for any rule to fire. It must come out "unknown" (step-up), never "human".
 */
async function shortRobot(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const page = await open(browser, url, true);
  const a = await center(page, '#amount');
  await sleep(1500);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down(); await page.mouse.up();
  await page.keyboard.type('250.00', { delay: 12 });
  await sleep(1500);
  const out = await finish(page, 'I. Short robotic session (2 teleport clicks, 12 ms typing)', async () => {
    const c = await center(page, '#send');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down(); await page.mouse.up();
  });
  await browser.close();
  return out;
}

/**
 * J: a relayed token. Session 1 asks for a transfer decision bound to the exact transfer the
 * attacker wants, then hands the token to session 2's API call. Right action, right transaction,
 * wrong app session: the API must refuse it on the binding alone.
 */
async function tokenRelay(url: string): Promise<Outcome> {
  const browser = await stealthBrowser();
  const donor = await open(browser, url, true);
  const token = await donor.evaluate(async () => {
    const AD = (window as any).AgentDetect.AgentDetect;
    return (await (window as any).__ad.decide('transfer', await AD.contextHash('x', '9999', 'USD'))).token;
  });
  const victim = await open(browser, url, true); // separate context = separate app session cookie
  const post = (page: Page) => page.evaluate(async (t) => {
    const r = await fetch('/api/transfer', { method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-detect': t }, body: JSON.stringify({ payee: 'x', amount: '9999' }) });
    return { status: r.status, body: await r.json() };
  }, token);
  const res = await post(victim);
  await browser.close();
  const ok = res.status === 403 && res.body.reason === 'binding';
  return { scenario: 'J. Token relayed from another session', decision: ok ? 'refused' : 'NOT REFUSED ON BINDING', verdict: '-', score: 0, hits: [], note: `API said ${res.status} ${JSON.stringify(res.body)}` };
}

async function main() {
  const { server, url } = await startDemo(Number(process.env.ATTACK_PORT) || 8790);
  const results: Outcome[] = [];
  const only = (process.env.SCENARIOS || '').split(',').filter(Boolean);
  const all = [stockPlaywright, xdotoolStyle, humanized, scriptInjection, fillEverything, backgroundTab, overlayViaCdp, extensionAgent, shortRobot, tokenRelay];
  for (const s of all.filter((f) => !only.length || only.includes(f.name))) {
    try { results.push(await s(url)); }
    catch (e) { results.push({ scenario: s.name, decision: 'ERROR', verdict: '-', score: 0, hits: [], note: String(e).slice(0, 200) }); }
  }
  server.close();

  for (const r of results) {
    console.log(`\n${r.scenario}\n  decision=${r.decision}  verdict=${r.verdict}  score=${r.score}${r.note ? `  (${r.note})` : ''}`);
    for (const h of r.hits || []) console.log(`   - ${h.id}: ${h.evidence}`);
    if (r.env) console.log(`   env: webdriver=${r.env.webdriver} cdpRuntime=${r.env.cdpRuntime} globals=[${r.env.automationGlobals}] tampered=[${r.env.nativeTampered}] renderer="${r.env.renderer}" ua-headless=${r.env.headlessUA}`);
  }
  const json = process.env.ATTACK_JSON;
  if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(results, null, 2));
}

main();
