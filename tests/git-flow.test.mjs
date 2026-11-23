import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBranch, checkChangedFiles, checkWorkingTree, commitDetails, isOpenPullRequest, summarizeReview } from '../.opencode/scripts/git-flow.mjs';

test('branch names are restricted to known feature namespaces', () => {
  for (const name of ['test/arch062-swap-fire', 'fix/gameplay-timing', 'feature/loot-v2', 'chore/ui-tests'])
    assert.equal(validateBranch(name), name);
  for (const name of ['main', 'refs/heads/main', 'release/main', 'test/../main', 'test/a.lock', 'test/a b', 'test/$(whoami)', 'test/a\nb'])
    assert.throws(() => validateBranch(name), /Недопустимое имя/);
});

test('protected game builds, infrastructure, and environment paths block publication', () => {
  const protectedPaths = ['index.html', 'AGENTS.md', 'opencode.jsonc', '.opencode/agents/architect.md',
    '.opencode/scripts/git-flow.mjs', '.github/workflows/ci.yml', 'arch061/js/boot.js',
    'arch062/js/gameplay.js', 'art01/index.html', 'arch03/index.html', 'v103/index.html',
    'releases/1.0.3-arch03/index.html', 'docs/releases.md', '.env', 'sub/.env.local',
    'game.js', 'style.css', 'play-v051.html', 'ashen-crusade-art02-walk.html', 'build.json',
    'js/gameplay.js', 'assets/hero-approved.webp', 'arch01/index.html', 'v101/index.html'];
  for (const path of protectedPaths) assert.throws(() => checkChangedFiles(['tests/new.cjs', path]), /защищённые пути/, path);
  assert.throws(() => checkChangedFiles(['tests/\nstrange.cjs']), /защищённые пути/);
  assert.deepEqual(checkChangedFiles(['tests/arch062-swap-fire.cjs', 'tests/arch062-contract.cjs']),
    ['tests/arch062-swap-fire.cjs', 'tests/arch062-contract.cjs']);
  assert.throws(() => checkChangedFiles([]), /Нет изменений/);
});

test('only the known macOS metadata file is ignored in working-tree checks', () => {
  assert.doesNotThrow(() => checkWorkingTree(''));
  assert.doesNotThrow(() => checkWorkingTree('?? .DS_Store\n'));
  assert.doesNotThrow(() => checkWorkingTree('?? docs/.DS_Store\n?? assets/sub/.DS_Store\n'));
  assert.throws(() => checkWorkingTree(' M game.js\n'), /не чистое/);
  assert.throws(() => checkWorkingTree('?? .DS_Store\n?? arbitrary.txt\n'), /не чистое/);
  assert.throws(() => checkWorkingTree(' M docs/.DS_Store\n'), /не чистое/);
});

test('a detailed commit message supplies the PR title and criteria', () => {
  const item = commitDetails('test: verify weapon switch\n\nЦель: регрессия переключения оружия.\nКритерии: тесты проходят, игровые файлы не меняются.\n');
  assert.equal(item.title, 'test: verify weapon switch');
  assert.match(item.body, /Критерии/);
  assert.throws(() => commitDetails('fix: short'), /содержательное тело/);
});

test('publication never mistakes a closed or merged PR for an open one', () => {
  assert.equal(isOpenPullRequest({ number: 12, url: 'https://github.com/a/b/pull/12', state: 'OPEN' }), true);
  assert.equal(isOpenPullRequest({ number: 12, url: 'https://github.com/a/b/pull/12', state: 'CLOSED' }), false);
  assert.equal(isOpenPullRequest({ number: 12, url: 'https://github.com/a/b/pull/12', state: 'MERGED' }), false);
  assert.equal(isOpenPullRequest(null), false);
});

test('report marks old PASS as stale when the PR head advances', () => {
  const comment = '<!-- ashen-cloud-review-bot -->\n## Облачное ревью PR — PASS\n\n- Коммит: `111111111111`';
  const base = { headRefOid: '1111111111111111111111111111111111111111',
    statusCheckRollup: [{ name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' }], comments: [{ body: comment }] };
  assert.equal(summarizeReview(base).verdict, 'PASS');
  const changed = summarizeReview({ ...base, headRefOid: '2222222222222222222222222222222222222222' });
  assert.equal(changed.verdict, 'PENDING');
  assert.equal(changed.reviewStale, true);
  assert.equal(changed.reviewerComment, null);
});

test('report waits for incomplete checks even when current review says PASS', () => {
  const comment = '<!-- ashen-cloud-review-bot -->\n## Облачное ревью PR — PASS\n\n- Коммит: `aaaaaaaaaaaa`';
  const sample = { headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comments: [{ body: comment }], statusCheckRollup: [{ name: 'CI', status: 'IN_PROGRESS', conclusion: null }] };
  assert.equal(summarizeReview(sample).verdict, 'PENDING');
  assert.equal(summarizeReview({ ...sample, statusCheckRollup: [] }).verdict, 'PENDING');
});

test('a failed CI check cannot be presented as final PASS', () => {
  const sample = { headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comments: [{ body: '<!-- ashen-cloud-review-bot -->\n## Облачное ревью PR — PASS\n- Коммит: `aaaaaaaaaaaa`' }],
    statusCheckRollup: [{ name: 'Contract tests', status: 'COMPLETED', conclusion: 'FAILURE' }] };
  const answer = summarizeReview(sample);
  assert.equal(answer.checksFailed, true);
  assert.equal(answer.verdict, 'BLOCKED');
});
