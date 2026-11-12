/**
 * One-shot environment checks. Runs once per page load (~a few ms).
 */
import type { EnvSnapshot } from '../core/types';

const AUTOMATION_GLOBALS = [
  // Playwright
  '__playwright__binding__', '__pwInitScripts', '__playwright_clock__',
  // Puppeteer
  '__puppeteer_utility_world__',
  // Selenium / WebDriver
  '_Selenium_IDE_Recorder', '_selenium', 'calledSelenium', '__webdriver_script_fn', '__driver_evaluate',
  '__webdriver_evaluate', '__selenium_evaluate', '__fxdriver_evaluate', '__driver_unwrapped',
  '__webdriver_unwrapped', '__selenium_unwrapped', '__fxdriver_unwrapped', '__webdriverFunc',
  '_WEBDRIVER_ELEM_CACHE', '__lastWatirAlert', '__lastWatirConfirm', '__lastWatirPrompt', '$chrome_asyncScriptInfo',
  // PhantomJS / Nightmare / misc
  'callPhantom', '_phantom', 'phantom', '__nightmare', 'domAutomation', 'domAutomationController',
];

const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Software Rasterizer|Basic Render|Mesa OffScreen|VMware SVGA/i;

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function makeProbeFrame(): HTMLIFrameElement | null {
  return safe(() => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    (document.body || document.documentElement).appendChild(f);
    return f;
  }, null);
}

function automationGlobals(): string[] {
  const found: string[] = [];
  const w = window as any;
  for (const k of AUTOMATION_GLOBALS) if (safe(() => k in w, false)) found.push(k);
  safe(() => {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (/^cdc_[a-z0-9]+_(Array|Promise|Symbol|JSON|Object|Proxy)$/i.test(k)) found.push(k); // ChromeDriver
    }
    for (const k of Object.getOwnPropertyNames(document)) {
      if (/^\$(cdc|wdc)_/.test(k)) found.push(k);
    }
    for (const a of ['webdriver', 'selenium', 'driver']) {
      if (document.documentElement.hasAttribute(a)) found.push(`html[${a}]`);
    }
  }, undefined);
  return [...new Set(found)];
}

function nativeTampered(frame: HTMLIFrameElement | null): string[] {
  const out: string[] = [];
  // Use a pristine Function.prototype.toString from a fresh iframe, so a
  // patched toString in the top frame cannot hide other patches.
  const fts: (this: unknown) => string =
    safe(() => (frame?.contentWindow as any).Function.prototype.toString, null) || Function.prototype.toString;
  const isNative = (fn: unknown) =>
    typeof fn === 'function' && /\{\s*\[native code\]\s*\}\s*$/.test(safe(() => fts.call(fn), ''));

  const getter = (proto: object, prop: string) => safe(() => Object.getOwnPropertyDescriptor(proto, prop)?.get, undefined);
  const checks: [string, unknown][] = [
    ['Function.prototype.toString', Function.prototype.toString],
    ['Permissions.prototype.query', safe(() => (window as any).Permissions?.prototype.query, undefined)],
    ['HTMLCanvasElement.prototype.toDataURL', HTMLCanvasElement.prototype.toDataURL],
    ['HTMLCanvasElement.prototype.getContext', HTMLCanvasElement.prototype.getContext],
    ['WebGLRenderingContext.prototype.getParameter', safe(() => WebGLRenderingContext.prototype.getParameter, undefined)],
    ['Navigator.webdriver getter', getter(Navigator.prototype, 'webdriver')],
    ['Navigator.languages getter', getter(Navigator.prototype, 'languages')],
    ['Navigator.plugins getter', getter(Navigator.prototype, 'plugins')],
    ['Navigator.hardwareConcurrency getter', getter(Navigator.prototype, 'hardwareConcurrency')],
    ['Navigator.userAgent getter', getter(Navigator.prototype, 'userAgent')],
  ];
  for (const [name, fn] of checks) {
    if (fn === undefined) continue; // API absent in this browser — not evidence
    if (!isNative(fn)) out.push(name);
  }
  // Chromium always defines webdriver on Navigator.prototype; deleting it is a stealth trick.
  if (/Chrome\//.test(navigator.userAgent) && getter(Navigator.prototype, 'webdriver') === undefined) {
    out.push('Navigator.webdriver removed');
  }
  return out;
}

/**
 * When the DevTools Protocol Runtime domain is enabled (Playwright and
 * Puppeteer enable it), console arguments are serialised for the protocol,
 * which reads an Error's `stack`. A getter on `stack` therefore fires.
 * A human with DevTools open triggers it too, so this is Tier 2 only.
 */
function cdpRuntime(): boolean {
  let hit = false;
  safe(() => {
    const e = new Error('ad-probe');
    Object.defineProperty(e, 'stack', { configurable: false, get() { hit = true; return ''; } });
    // eslint-disable-next-line no-console
    console.debug(e);
  }, undefined);
  return hit;
}

function renderer(): string {
  return safe(() => {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'no-webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }, 'unknown');
}

export function collectEnv(): EnvSnapshot {
  const frame = makeProbeFrame();
  const nav = navigator as any;
  const top = nav.webdriver === true;
  const inFrame = safe(() => (frame?.contentWindow as any)?.navigator.webdriver === true, top);
  const r = renderer();
  const snap: EnvSnapshot = {
    webdriver: top,
    webdriverIframeMismatch: frame ? top !== inFrame : false,
    webdriverOwnProperty: safe(() => Object.prototype.hasOwnProperty.call(navigator, 'webdriver'), false),
    headlessUA: /HeadlessChrome/.test(navigator.userAgent),
    automationGlobals: automationGlobals(),
    nativeTampered: nativeTampered(frame),
    cdpRuntime: cdpRuntime(),
    renderer: r.slice(0, 120),
    softwareRenderer: SOFTWARE_GPU.test(r),
    screenW: screen.width,
    screenH: screen.height,
    platform: String(nav.userAgentData?.platform || navigator.platform || '').slice(0, 40),
    pointerFine: safe(() => matchMedia('(pointer: fine)').matches, false),
    touchPoints: navigator.maxTouchPoints || 0,
    languages: safe(() => navigator.languages.length, 0),
  };
  safe(() => frame?.remove(), undefined);
  return snap;
}
