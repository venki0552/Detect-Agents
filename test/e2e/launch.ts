/**
 * Shared browser launch options for the e2e files.
 * CHROMIUM_PATH=/path/to/chrome uses that binary instead of Playwright's bundled Chromium
 * (handy when the bundled build for this Playwright version is not installed).
 */
import type { LaunchOptions } from 'playwright';

export function launchOptions(extra: LaunchOptions = {}): LaunchOptions {
  const exe = process.env.CHROMIUM_PATH;
  return exe ? { ...extra, executablePath: exe } : { channel: 'chromium', ...extra };
}
