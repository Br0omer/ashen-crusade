import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoBranchName, incrementSpecPath } from '../.opencode/scripts/git-flow.mjs';
import { changedStatusPaths, readIncrementSpec } from '../.opencode/scripts/dev-flow.mjs';
import { buildReviewMessages } from '../.github/scripts/review-core.mjs';

const agent = (name) => readFileSync(new URL(`../.opencode/agents/${name}.md`, import.meta.url), 'utf8');
function rules(name) {
  const fm = agent(name).match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, `agent frontmatter missing: ${name}`);
  const parsed = [...fm[1].matchAll(/  - action: ([^\n]+)\n    resource: ([^\n]+)\n    effect: ([^\n]+)/g)]
    .map(([, action, resource, effect]) => ({
      action: action.replaceAll('"', ''), resource: resource.replaceAll('"', ''), effect,
    }));
  assert.equal(parsed.length, fm[1].split('\n').filter(x => /^  - /.test(x)).length);
  return parsed;
}
const rule = (items, action, resource, effect) =>
  items.some(x => x.action === action && x.resource === resource && x.effect === effect);

test('generated branch names are safe and not controlled by shell arguments', () => {
  const name = autoBranchName(new Date('2026-11-23T00:00:00Z'), 'deadbeef');
  assert.equal(name, 'feature/inc-20261123-deadbeef');
  assert.equal(incrementSpecPath(name), 'docs/increments/feature-inc-20261123-deadbeef.md');
  assert.equal(incrementSpecPath('test/arch062-swap-fire'), 'docs/increments/test-arch062-swap-fire.md');
  assert.throws(() => autoBranchName(new Date('garbage'), 'deadbeef'));
  assert.throws(() => autoBranchName(new Date(), 'x;evil'));
  assert.throws(() => incrementSpecPath('main'));
});

test('developer status parsing keeps leading space and ignores only untracked DS_Store', () => {
  assert.deepEqual(changedStatusPaths(' M tests/example.cjs\0?? .DS_Store\0?? docs/increments/new.md\0'),
    ['tests/example.cjs', 'docs/increments/new.md']);
  assert.throws(() => changedStatusPaths('R  old.txt\0new.txt\0'), /Переименование/);
  assert.throws(() => changedStatusPaths('?? -file.txt\0'), /Небезопасный/);
});

const validSpec = `# Инкремент

## Цель
Проверить переключение оружия в тот же игровой тик, что и стрельба.

## Критерии приёмки
- При RB и RT одновременно применяется согласованный порядок действий.
- Принятая игра не изменяется.

## Проверки
- Node регрессионный тест проходит.
- Пользователь проводит ручную приёмку, если меняется поведение.
`;
test('developer requires a meaningful specification with acceptance and tests', () => {
  const item = readIncrementSpec('test/arch062-swap-fire', validSpec);
  assert.equal(item.path, 'docs/increments/test-arch062-swap-fire.md');
  assert.match(item.goal, /переключение оружия/);
  assert.throws(() => readIncrementSpec('test/arch062-swap-fire',
    validSpec.replace('## Критерии приёмки', '## Разное')), /Критерии приёмки/);
  assert.throws(() => readIncrementSpec('test/arch062-swap-fire', 'коротко'), /160/);
});

test('Developer may edit only through protected deny list and invoke fixed local commands', () => {
  const items = rules('developer');
  assert.ok(rule(items, 'edit', '*', 'allow'));
  for (const p of ['AGENTS.md', 'opencode.jsonc', '.github/**', '.opencode/**', 'docs/releases.md',
    'arch061/**', 'arch062/**', 'art02-gait-study/**', 'art02-armor-study/**',
    'js/**', 'assets/**', 'releases/**']) assert.ok(rule(items, 'edit', p, 'deny'), p);
  assert.ok(rule(items, 'shell', '*', 'deny'));
  const shell = items.filter(x => x.action === 'shell' && x.effect === 'allow');
  assert.deepEqual(shell.map(x => x.resource), [
    'node .opencode/scripts/dev-flow.mjs status',
    'node .opencode/scripts/dev-flow.mjs check',
    'node .opencode/scripts/dev-flow.mjs commit',
  ]);
  assert.ok(rule(items, 'subagent', '*', 'deny'));
});

test('Game Designer is read-only and uses an economical cloud model', () => {
  const raw = agent('game-designer');
  const items = rules('game-designer');
  assert.match(raw, /mode: subagent/);
  assert.match(raw, /model: openrouter\/google\/gemini-4-hydrogen/);
  for (const action of ['edit', 'shell', 'subagent']) assert.ok(rule(items, action, '*', 'deny'));
  assert.ok(!items.some(x => x.effect === 'allow' && ['edit', 'shell'].includes(x.action)));
});

test('Gemini has QA and gameplay regression requirements beyond code review', () => {
  const messages = buildReviewMessages({
    pr: { number: 1, title: 'Test', body: 'Check mechanic', base: { ref: 'main' }, head: { sha: 'a'.repeat(40) } },
    files: [], diff: '', sources: '', agents: 'rules', roadmap: 'plan', releases: 'versions',
  });
  assert.match(messages[0].content, /QA/);
  assert.match(messages[0].content, /геймпад/);
  assert.match(messages[0].content, /одновременн/);
  assert.match(messages[0].content, /manual_checks/);
});
