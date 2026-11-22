import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedReview, ciCommitMatchesHead, parseReview, prepareChanges, renderComment, ReviewBlocked } from '../.github/scripts/review-core.mjs';

const patch = { filename: 'src/player.js', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' };

test('review uses the actual diff', () => {
  const text = prepareChanges([patch]);
  assert.match(text, /src\/player\.js/);
  assert.match(text, /\+new/);
});

test('missing binary diff cannot be approved', () => {
  assert.throws(() => prepareChanges([{ ...patch, patch: undefined }]), ReviewBlocked);
});

test('CI on PR merge commit is accepted only when its parent is the current PR head', () => {
  const head = 'a'.repeat(40);
  const oldHead = 'b'.repeat(40);
  const merge = 'c'.repeat(40);
  assert.equal(ciCommitMatchesHead(head, head), true);
  assert.equal(ciCommitMatchesHead(merge, head, [{ sha: oldHead }, { sha: head }]), true);
  assert.equal(ciCommitMatchesHead(merge, head, [{ sha: oldHead }]), false);
});

test('oversized PR cannot be partially approved', () => {
  assert.throws(() => prepareChanges([patch, patch], { maxFiles: 1 }), ReviewBlocked);
  assert.throws(() => prepareChanges([patch], { maxPatchChars: 5 }), ReviewBlocked);
});

test('parses fenced JSON and changes PASS with actionable findings to CHANGES_REQUESTED', () => {
  const answer = parseReview('```json\n' + JSON.stringify({
    verdict: 'PASS',
    summary: 'Проверена точка спавна.',
    findings: [{ severity: 'high', file: 'src/player.js', problem: 'Ошибка.', fix: 'Исправить.' }],
    manual_checks: ['Проверить геймпад'],
  }) + '\n```');
  assert.equal(answer.verdict, 'CHANGES_REQUESTED');
  assert.deepEqual(answer.manualChecks, ['Проверить геймпад']);
});

test('malformed answers fail closed', () => {
  assert.throws(() => parseReview('looks good'), ReviewBlocked);
  assert.throws(() => parseReview('{"verdict":"PASS"}'), ReviewBlocked);
  assert.throws(() => parseReview(''), ReviewBlocked);
});

test('published comment has commit, CI, verdict and owner-only acceptance', () => {
  const comment = renderComment(blockedReview('CI не завершён.'), {
    headSha: '1234567890abcdef',
    ciUrl: 'https://github.com/example/actions/runs/123',
    model: '',
  });
  assert.match(comment, /BLOCKED/);
  assert.match(comment, /1234567890ab/);
  assert.match(comment, /Contract tests/);
  assert.match(comment, /решение принимает владелец/);
});
