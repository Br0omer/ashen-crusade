#!/usr/bin/env node
/* Ashen Crusade Git Operator: narrowly scoped local Git/GitHub operations.
 * Never merges, force-pushes, deletes branches, or pushes to main.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Br0omer/ashen-crusade';
const BRANCH_RE = /^(?:test|fix|feature|chore)\/[a-z0-9][a-z0-9._-]{1,63}$/;
const RESERVED_FILES = new Set(['AGENTS.md', 'opencode.jsonc', 'index.html', 'docs/releases.md']);
const RESERVED_DIRS = ['.github/', '.opencode/', 'arch061/', 'arch062/', 'v103/', 'arch03/', 'art01/', 'releases/'];

export function validateBranch(name) {
  if (typeof name !== 'string' || !BRANCH_RE.test(name) || name.includes('..') || name.endsWith('.lock'))
    throw new Error('Недопустимое имя ветки: нужен префикс test/, fix/, feature/ или chore/ и безопасный slug.');
  return name;
}

export function checkChangedFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Нет изменений относительно origin/main.');
  const blocked = files.filter(p => RESERVED_FILES.has(p) || RESERVED_DIRS.some(d => p.startsWith(d)) ||
    /(?:^|\/)\.env(?:\.|$)/i.test(p) || p.split('/').includes('..') || /[\x00-\x1f]/.test(p));
  if (blocked.length) throw new Error('Изменены защищённые пути: ' + blocked.join(', ') + '. Нужен отдельный согласованный процесс.');
  return files;
}

export function checkWorkingTree(porcelain) {
  const lines = String(porcelain).split(/\r?\n/).filter(Boolean);
  const unexpected = lines.filter(line => line !== '?? .DS_Store');
  if (unexpected.length) throw new Error('Рабочее дерево не чистое: ' + unexpected.join(' | ').slice(0, 700));
}

export function commitDetails(message) {
  const [title, ...bodyLines] = String(message).trim().split(/\r?\n/);
  const body = bodyLines.join('\n').trim();
  if (!title || title.length > 110 || body.length < 30)
    throw new Error('Последний коммит должен содержать заголовок и содержательное тело (цель, критерии, проверки).');
  return { title, body };
}

export function isOpenPullRequest(pr) {
  return !!pr && pr.state === 'OPEN' && Number.isInteger(pr.number) && typeof pr.url === 'string';
}

function run(program, args, { timeout = 120000, quiet = false, allowFailure = false } = {}) {
  const out = spawnSync(program, args, { encoding: 'utf8', timeout, shell: false, maxBuffer: 2 * 1024 * 1024 });
  if (out.error || (out.status !== 0 && !allowFailure)) {
    if (quiet) throw new Error(`Команда ${program} недоступна или не завершилась успешно.`);
    throw new Error(`${program} ${args[0] || ''}: ${(out.stderr || out.stdout || out.error?.message || 'ошибка').slice(-1500)}`);
  }
  return out;
}
const git = (args, opts) => run('git', args, opts).stdout.trim();
const gh = (args, opts) => run('gh', ['--repo', REPO, ...args], opts).stdout.trim();

function assertRepository() {
  const root = git(['rev-parse', '--show-toplevel']);
  if (realpathSync(root) !== realpathSync(resolve('.')))
    throw new Error('Запусти Git Operator из корня рабочего репозитория.');
  const origin = git(['remote', 'get-url', 'origin']);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)Br0omer\/ashen-crusade(?:\.git)?$/i.test(origin))
    throw new Error('origin не соответствует ожидаемому репозиторию Br0omer/ashen-crusade.');
}
function branch() {
  const name = git(['branch', '--show-current']);
  if (!name) throw new Error('Detached HEAD: операция запрещена.');
  return name;
}
function ensureClean() { checkWorkingTree(git(['status', '--porcelain=v1', '--untracked-files=all'])); }
function requireGithubCLI() {
  run('gh', ['--version'], { quiet: true });
  run('gh', ['auth', 'status'], { quiet: true });
}
function ensureMainAncestor() {
  git(['fetch', 'origin', 'main']);
  const ancestry = run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { allowFailure: true });
  if (ancestry.status !== 0) throw new Error('Ветка не основана на актуальном origin/main. Нужна отдельная проверка обновления.');
}

function start(name) {
  validateBranch(name); ensureClean();
  git(['switch', 'main']);
  git(['pull', '--ff-only', 'origin', 'main']);
  git(['switch', '-c', name]);
  console.log(JSON.stringify({ operation: 'start', branch: name, base: 'origin/main', result: 'ready_for_developer' }));
}

function runContracts() {
  for (const args of [
    ['tests/arch061-contract.cjs'],
    ['tests/arch062-contract.cjs'],
    ['--test', 'tests/openrouter-review.test.mjs'],
    ['--test', 'tests/git-flow.test.mjs'],
  ]) {
    const result = run(process.execPath, args);
    if (result.status !== 0) throw new Error('Тест не пройден: ' + args.join(' '));
    console.log('PASS: node ' + args.join(' '));
  }
}

function publish() {
  const name = validateBranch(branch()); ensureClean(); ensureMainAncestor();
  const paths = git(['diff', '-z', '--name-only', '--no-ext-diff', 'origin/main..HEAD']).split('\0').filter(Boolean);
  checkChangedFiles(paths);
  const commits = Number(git(['rev-list', '--count', 'origin/main..HEAD']));
  if (!Number.isInteger(commits) || commits < 1) throw new Error('Нет коммитов в рабочей ветке.');
  const { title, body } = commitDetails(git(['log', '-1', '--format=%B']));
  requireGithubCLI();
  runContracts();
  git(['push', '--set-upstream', 'origin', `HEAD:refs/heads/${name}`]);
  const existing = run('gh', ['pr', 'view', name, '--repo', REPO, '--json', 'number,url,state'], { allowFailure: true });
  let result;
  const previous = existing.status === 0 ? JSON.parse(existing.stdout) : null;
  if (isOpenPullRequest(previous)) {
    result = previous;
  } else {
    const url = run('gh', ['pr', 'create', '--repo', REPO, '--base', 'main', '--head', name,
      '--title', title, '--body', `${body}\n\n---\nАвтоматически создано Git Operator. CI и независимое ревью обязательны. Merge — только по решению владельца.`]).stdout.trim();
    result = { url };
  }
  console.log(JSON.stringify({ operation: 'publish', branch: name, changedFiles: paths, ...result }));
}

function report() {
  const name = validateBranch(branch());
  requireGithubCLI();
  const raw = run('gh', ['pr', 'view', name, '--repo', REPO, '--json', 'number,url,state,headRefOid,statusCheckRollup,comments']).stdout;
  const pr = JSON.parse(raw);
  const reviews = (pr.comments || []).filter(x => x.body?.includes('<!-- ashen-cloud-review-bot -->'));
  const comment = reviews.at(-1)?.body || null;
  const verdict = comment?.match(/Облачное ревью PR\s*[—-]\s*(PASS|CHANGES_REQUESTED|BLOCKED)/)?.[1] || 'PENDING';
  const checks = (pr.statusCheckRollup || []).map(x => ({ name: x.name || x.context,
    state: x.status || x.state, conclusion: x.conclusion || null }));
  console.log(JSON.stringify({ operation: 'report', branch: name, pr: pr.number, url: pr.url,
    head: pr.headRefOid, state: pr.state, checks, verdict, reviewerComment: comment?.slice(0, 12000) || null }));
}

function main() {
  assertRepository();
  const [action, ...args] = process.argv.slice(2);
  if (action === 'status' && args.length === 0) {
    console.log(JSON.stringify({ operation: 'status', branch: branch(), workingTree: git(['status', '--short']) }));
  } else if (action === 'start' && args.length === 1) start(args[0]);
  else if (action === 'publish' && args.length === 0) publish();
  else if (action === 'report' && args.length === 0) report();
  else throw new Error('Допустимые команды: status | start <branch> | publish | report.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('Git Operator BLOCKED: ' + error.message); process.exitCode = 1; }
}
