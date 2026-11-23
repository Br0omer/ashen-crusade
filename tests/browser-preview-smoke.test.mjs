import test from 'node:test';
import assert from 'node:assert/strict';
import { changedPrototypePages, previewUrl, assertBrowserHealthy, isRetryableHtmlStatus } from './browser-preview-smoke.mjs';

test('only changed prototypes with index pages are smoke-tested', () => {
  const names = changedPrototypePages([
    'prototypes/rifles-b1/js/render.js', 'prototypes/rifles-b1/index.html',
    'docs/increments/x.md', 'tests/arch062-contract.cjs',
    'prototypes/no-index/js/gameplay.js',
  ], p => p === 'prototypes/rifles-b1/index.html');
  assert.deepEqual(names, ['prototypes/rifles-b1/index.html']);
});

test('preview URLs are immutable SHA-pinned and reject path traversal', () => {
  const sha = 'a'.repeat(40);
  assert.equal(previewUrl(sha, 'prototypes/rifles-b1/index.html'),
    'https://raw.githack.com/Br0omer/ashen-crusade/' + sha + '/prototypes/rifles-b1/index.html');
  assert.throws(() => previewUrl('main', 'prototypes/rifles-b1/index.html'));
  assert.throws(() => previewUrl(sha, '../arch062/index.html'));
  assert.throws(() => previewUrl(sha, 'prototypes/../index.html'));
});

test('runtime exceptions and failed asset requests prevent browser smoke PASS', () => {
  assert.doesNotThrow(() => assertBrowserHealthy([]));
  assert.throws(() => assertBrowserHealthy(['Uncaught Error: render failed']), /render failed/);
  assert.throws(() => assertBrowserHealthy(['request failed: hero-approved.webp ERR_CORS']), /ERR_CORS/);
});

test('only transient first HTML response statuses are retryable', () => {
  for (const status of [404, 429, 500, 502, 503, 504])
    assert.equal(isRetryableHtmlStatus(status), true);
  for (const status of [200, 301, 302, 400, 401, 403, 418])
    assert.equal(isRetryableHtmlStatus(status), false);
});
