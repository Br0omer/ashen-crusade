import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBranch, checkChangedFiles, checkWorkingTree, commitDetails } from '../.opencode/scripts/git-flow.mjs';

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
    'releases/1.0.3-arch03/index.html', 'docs/releases.md', '.env', 'sub/.env.local'];
  for (const path of protectedPaths) assert.throws(() => checkChangedFiles(['tests/new.cjs', path]), /защищённые пути/, path);
  assert.throws(() => checkChangedFiles(['tests/\nstrange.cjs']), /защищённые пути/);
  assert.deepEqual(checkChangedFiles(['tests/arch062-swap-fire.cjs', 'tests/arch062-contract.cjs']),
    ['tests/arch062-swap-fire.cjs', 'tests/arch062-contract.cjs']);
  assert.throws(() => checkChangedFiles([]), /Нет изменений/);
});

test('only the known macOS metadata file is ignored in working-tree checks', () => {
  assert.doesNotThrow(() => checkWorkingTree(''));
  assert.doesNotThrow(() => checkWorkingTree('?? .DS_Store\n'));
  assert.throws(() => checkWorkingTree(' M game.js\n'), /не чистое/);
  assert.throws(() => checkWorkingTree('?? .DS_Store\n?? arbitrary.txt\n'), /не чистое/);
});

test('a detailed commit message supplies the PR title and criteria', () => {
  const item = commitDetails('test: verify weapon switch\n\nЦель: регрессия переключения оружия.\nКритерии: тесты проходят, игровые файлы не меняются.\n');
  assert.equal(item.title, 'test: verify weapon switch');
  assert.match(item.body, /Критерии/);
  assert.throws(() => commitDetails('fix: short'), /содержательное тело/);
});
