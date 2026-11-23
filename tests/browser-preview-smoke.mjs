// Real Chromium smoke of the exact published commit over raw.githack HTTPS.
// Runs only in the unprivileged PR CI job; never in the trusted reviewer job.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function changedPrototypePages(paths, hasFile = existsSync) {
  if (!Array.isArray(paths)) throw new TypeError('Expected changed paths');
  const names = [...new Set(paths.map(p => /^prototypes\/([a-z0-9-]+)\//.exec(p)?.[1]).filter(Boolean))];
  return names.filter(name => hasFile('prototypes/' + name + '/index.html'))
    .map(name => 'prototypes/' + name + '/index.html');
}

export function previewUrl(sha, page, repo = 'Br0omer/ashen-crusade') {
  if (!/^[a-f0-9]{40}$/i.test(sha) ||
      !/^prototypes\/[a-z0-9-]+\/index\.html$/.test(page) ||
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo))
    throw new Error('Unsafe preview URL inputs');
  return 'https://raw.githack.com/' + repo + '/' + sha + '/' + page;
}

export function assertBrowserHealthy(errors) {
  if (!Array.isArray(errors)) throw new TypeError('Browser error list is required');
  if (errors.length) throw new Error('Page/network errors: ' + errors.slice(0, 12).join('; '));
}

async function smoke(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message.slice(0, 400)));
    page.on('requestfailed', request => errors.push(
      'request failed: ' + request.url().slice(0, 150) + ' ' + (request.failure()?.errorText || '')));
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (response?.status() !== 200) throw new Error('HTML status ' + response?.status());
    await page.waitForFunction(() => {
      const status = document.getElementById('asset-status');
      const button = document.getElementById('play');
      return button && !button.disabled && status && status.textContent.includes('загружен');
    }, null, { timeout: 30000 });
    const ready = await page.evaluate(() => {
      const img = document.getElementById('hero-preview');
      const status = document.getElementById('asset-status');
      return {
        image: !!img && img.complete && img.naturalWidth > 0,
        status: status?.textContent || '',
        startEnabled: !document.getElementById('play')?.disabled,
      };
    });
    if (!ready.image || !ready.startEnabled) throw new Error('Hero canvas not ready: ' + JSON.stringify(ready));
    await page.click('#play', { timeout: 10000 });
    // Observe the UI contract, not lexical globals (the game may later use ES modules).
    await page.waitForFunction(() => {
      const overlay = document.getElementById('start');
      const canvas = document.getElementById('c');
      return overlay && getComputedStyle(overlay).display === 'none' &&
        canvas && canvas.width > 0 && canvas.height > 0;
    }, null, { timeout: 10000 });
    // Allow two actual animation frames to surface errors in the game's render loop.
    await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assertBrowserHealthy(errors);
    console.log('PASS Browser smoke: hero loaded, preview displayed, start enabled, game running: ' + url);
  } catch (error) {
    throw new Error('Browser smoke failed: ' + error.message +
      (errors.length ? ' | Browser events: ' + errors.slice(0, 12).join('; ') : ''));
  } finally {
    await browser.close();
  }
}

async function main() {
  const sha = process.env.PR_HEAD_SHA, base = process.env.PR_BASE_SHA;
  if (!/^[0-9a-f]{40}$/i.test(sha || '') || !/^[0-9a-f]{40}$/i.test(base || ''))
    throw new Error('PR_HEAD_SHA and PR_BASE_SHA must be full immutable SHAs');
  const changes = execFileSync('git', ['diff', '--name-only', base + '...' + sha], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  const pages = changedPrototypePages(changes);
  if (!pages.length) { console.log('SKIP: no changed browser prototype'); return; }
  for (const path of pages) await smoke(previewUrl(sha, path));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
