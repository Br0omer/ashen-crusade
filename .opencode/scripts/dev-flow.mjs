#!/usr/bin/env node
/* Developer's restricted local workflow: status, tests, and a reviewed local commit.
 * Shell commands have fixed arguments, no shell expansion and no GitHub writes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBranch, checkChangedFiles, incrementSpecPath } from './git-flow.mjs';

const REPO = 'Br0omer/ashen-crusade';
const TESTS = [
  ['tests/arch061-contract.cjs'],
  ['tests/arch062-contract.cjs'],
  ['--test', 'tests/openrouter-review.test.mjs'],
  ['--test', 'tests/git-flow.test.mjs'],
  ['--test', 'tests/pipeline-v2.test.mjs'],
];

function run(program, args, { allowFailure = false } = {}) {
  const r = spawnSync(program, args, {
    encoding: 'utf8', shell: false, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  if (r.error || (r.status !== 0 && !allowFailure))
    throw new Error(`${program} ${args[0] || ''}: ${(r.stderr || r.stdout || r.error?.message || 'ошибка').slice(-1200)}`);
  return r;
}
const git = (args) => run('git', args).stdout.trim();

function assertRepo() {
  const root = git(['rev-parse', '--show-toplevel']);
  if (realpathSync(root) !== realpathSync(resolve('.'))) throw new Error('Не корень репозитория.');
  const origin = git(['remote', 'get-url', 'origin']);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)Br0omer\/ashen-crusade(?:\.git)?$/i.test(origin))
    throw new Error('Неожиданный origin; операция остановлена.');
}
function activeBranch() {
  const branch = git(['branch', '--show-current']);
  return validateBranch(branch); // main, detached HEAD and unexpected names cannot commit
}
export function changedStatusPaths(status) {
  if (typeof status !== 'string') throw new Error('Некорректный git status.');
  const entries = status.split('\0').filter(Boolean);
  const paths = [];
  for (const item of entries) {
    if (item.length < 4 || item[2] !== ' ') throw new Error('Неожиданный формат git status --porcelain -z.');
    const xy = item.slice(0, 2);
    if (/[RC]/.test(xy)) throw new Error('Переименование/копирование требует отдельной ручной проверки.');
    const path = item.slice(3);
    if (xy === '??' && /(?:^|\/)\.DS_Store$/.test(path)) continue;
    if (!path || path.startsWith('-') || path.includes('\n') || path.includes('\r')) throw new Error('Небезопасный путь Git.');
    paths.push(path);
  }
  return [...new Set(paths)];
}
export function readIncrementSpec(name, content) {
  const path = incrementSpecPath(name);
  const text = String(content || '').trim();
  if (text.length < 160 || text.length > 8000)
    throw new Error(`Для ${path} нужен согласованный план объёмом 160–8000 символов.`);
  const fields = ['Цель', 'Критерии приёмки', 'Проверки'];
  for (const header of fields) {
    if (!new RegExp('^## ' + header + '\\s*$', 'm').test(text))
      throw new Error(`В ${path} отсутствует раздел: ${header}`);
  }
  const goal = text.match(/^## Цель\s*\n([^\n]+)/m)?.[1]?.trim();
  if (!goal || goal.length > 300) throw new Error('Нужна однострочная цель до 300 символов.');
  return { path, text, goal };
}
function spec(branch) {
  const path = incrementSpecPath(branch);
  return readIncrementSpec(branch, readFileSync(path, 'utf8'));
}
function changedFiles() {
  const raw = run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout;
  const paths = changedStatusPaths(raw);
  if (!paths.length) throw new Error('Нет изменений для коммита.');
  checkChangedFiles(paths);
  return paths;
}
function checks() {
  for (const args of TESTS) {
    run(process.execPath, args);
    console.log('PASS: node ' + args.join(' '));
  }
}
function prepare() {
  assertRepo();
  const branch = activeBranch();
  const plan = spec(branch);
  const paths = changedFiles();
  checks();
  return { branch, plan, paths };
}
function commit() {
  const { branch, plan, paths } = prepare();
  // Stage only explicitly validated paths: never git add -A for the whole repository.
  run('git', ['add', '--', ...paths]);
  const staged = run('git', ['diff', '--cached', '--name-only', '-z']).stdout.split('\0').filter(Boolean);
  checkChangedFiles(staged);
  const prefix = branch.startsWith('test/') ? 'test' : branch.startsWith('fix/') ? 'fix' : 'feat';
  const title = `${prefix}: ${branch.split('/')[1]}`;
  const message = `Цель: ${plan.goal}\n\nСогласованное ТЗ: ${plan.path}.\nКритерии и проверки: см. приложенный документ инкремента.\n\nВыполнены: ${TESTS.map(x => 'node ' + x.join(' ')).join('; ')}.\nИзменённые файлы: ${staged.join(', ').slice(0, 850)}.`;
  run('git', ['commit', '-m', title, '-m', message]);
  console.log(JSON.stringify({ operation: 'commit', branch, sha: git(['rev-parse', 'HEAD']),
    spec: plan.path, changedFiles: staged, tests: 'PASS', result: 'ready_for_architect' }));
}
// Only the exact untracked sidecar of the active increment may be removed.
// No arbitrary path arguments, globbing, directory deletion or tracked-file removal.
export function incrementTempPath(name) { return incrementSpecPath(name) + '.tmp'; }

function cleanup() {
  assertRepo();
  const path = incrementTempPath(activeBranch());
  if (!existsSync(path)) {
    console.log(JSON.stringify({ operation: 'cleanup', result: 'nothing_to_remove', path }));
    return;
  }
  const item = lstatSync(path);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 4096)
    throw new Error('Временный файл не является небольшим обычным файлом; очистка запрещена.');
  const status = run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', path]).stdout;
  if (status !== '?? ' + path + '\0')
    throw new Error('Удалять можно только неотслеживаемый временный файл текущего инкремента.');
  unlinkSync(path);
  console.log(JSON.stringify({ operation: 'cleanup', result: 'removed', path }));
}

function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Допустимые команды без аргументов: status | check | commit | cleanup.');
  if (command === 'status') {
    assertRepo();
    console.log(JSON.stringify({ operation: 'status', branch: git(['branch', '--show-current']),
      workingTree: git(['status', '--short']) }));
  } else if (command === 'cleanup') cleanup();
  else if (command === 'check') {
    const result = prepare();
    console.log(JSON.stringify({ operation: 'check', branch: result.branch,
      changedFiles: result.paths, spec: result.plan.path, tests: 'PASS' }));
  } else if (command === 'commit') commit();
  else throw new Error('Допустимые команды: status | check | commit.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('Developer Flow BLOCKED: ' + error.message); process.exitCode = 1; }
}
