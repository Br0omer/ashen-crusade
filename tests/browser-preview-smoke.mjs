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
        character: typeof characterVisual !== 'undefined' && characterVisual.getStatus() === 'ready',
      };
    });
    if (!ready.image || !ready.character) throw new Error('Hero canvas not ready: ' + JSON.stringify(ready));
    await page.click('#play', { timeout: 10000 });
    const started = await page.evaluate(() => {
      const start = document.getElementById('start');
      return typeof running !== 'undefined' && running === true &&
        start && getComputedStyle(start).display === 'none';
    });
    if (!started) throw new Error('Start button did not enter gameplay');
    console.log('PASS Browser smoke: hero loaded, preview displayed, start enabled, game running: ' + url);
  } catch (error) {
    throw new Error('Browser smoke failed: ' + error.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  const sha = process.env.PR_HEAD_SHA;
  if (!sha) throw new Error('PR_HEAD_SHA is required: never smoke a mutable branch URL');
  const changes = execFileSync('git', ['diff', '--name-only', 'HEAD^1', 'HEAD^2'], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  const pages = changedPrototypePages(changes);
  if (!pages.length) { console.log('SKIP: no changed browser prototype'); return; }
  for (const path of pages) await smoke(previewUrl(sha, path));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
