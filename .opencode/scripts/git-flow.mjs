#!/usr/bin/env node
/* Ashen Crusade Git Operator: narrowly scoped local Git/GitHub operations.
 * Never merges, force-pushes, deletes branches, or pushes to main.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Br0omer/ashen-crusade';
const BRANCH_RE = /^(?:test|fix|feature|chore)\/[a-z0-9][a-z0-9._-]{1,63}$/;
const RESERVED_FILES = new Set(['AGENTS.md', 'opencode.jsonc', 'index.html', 'docs/releases.md']);
const RESERVED_DIRS = ['.github/', '.opencode/', 'arch061/', 'arch062/', 'v103/', 'arch03/', 'art01/',
  'arch01/', 'arch02/', 'arch05/', 'v101/', 'v102/', 'releases/', 'js/', 'assets/',
  'art02/', 'art02-fix1/', 'art02-frames/', 'art02-gait-study/', 'art02-armor-study/'];
const ROOT_ASSET = /^[^/]+\.(?:html?|[cm]?js|css|svg|png|jpe?g|webp|json)$/i;

export function validateBranch(name) {
  if (typeof name !== 'string' || !BRANCH_RE.test(name) || name.includes('..') || name.endsWith('.lock'))
    throw new Error('Недопустимое имя ветки: нужен префикс test/, fix/, feature/ или chore/ и безопасный slug.');
  return name;
}

export function autoBranchName(now = new Date(), suffix = randomBytes(4).toString('hex')) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || !/^[0-9a-f]{8}$/.test(suffix))
    throw new Error('Некорректные параметры генерации ветки.');
  return validateBranch('feature/inc-' + now.toISOString().slice(0, 10).replaceAll('-', '') + '-' + suffix);
}

export function incrementSpecPath(name) {
  const safe = validateBranch(name);
  return 'docs/increments/' + safe.replace('/', '-') + '.md';
}

export function checkChangedFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Нет изменений относительно origin/main.');
  const blocked = files.filter(p => RESERVED_FILES.has(p) || RESERVED_DIRS.some(d => p.startsWith(d)) || ROOT_ASSET.test(p) ||
    /(?:^|\/)\.env(?:\.|$)/i.test(p) || p.split('/').includes('..') || /[\x00-\x1f]/.test(p));
  if (blocked.length) throw new Error('Изменены защищённые пути: ' + blocked.join(', ') + '. Нужен отдельный согласованный процесс.');
  return files;
}


export function tabletPreviewSection(paths, sha, hasIndex = (path) => existsSync(path)) {
  if (!Array.isArray(paths) || !/^[0-9a-f]{40}$/i.test(sha))
    throw new Error('Некорректные входные данные предпросмотра.');
  const names = [...new Set(paths.map(path => /^prototypes\/([a-z0-9-]+)\//.exec(path)?.[1]).filter(Boolean))];
  const links = names.filter(name => hasIndex('prototypes/' + name + '/index.html'));
  if (!links.length) return '';
  return [
    '<!-- ashen-tablet-preview:start -->',
    '## 🎮 Тестирование на планшете',
    '',
    ...links.map(name => '- **Открыть ' + name + ':** https://raw.githack.com/' + REPO + '/' + sha + '/prototypes/' + name + '/index.html'),
    '- **Commit SHA:** `' + sha + '`',
    '- **Статус ссылки:** UNVERIFIED — URL сформирован; реальную загрузку подтверждает браузерный smoke-test в CI.',
    '- **Игровая приёмка:** PENDING до проверки владельцем на Galaxy Tab S9+ и Xbox Controller.',
    '- **Ручная проверка:** герой загружается, кнопка старта доступна, ввод и игровые механики работают.',
    '<!-- ashen-tablet-preview:end -->',
  ].join('\n');
}

export function replaceTabletPreview(body, section) {
  const start = '<!-- ashen-tablet-preview:start -->';
  const end = '<!-- ashen-tablet-preview:end -->';
  if (!body.includes(start) && !body.includes(end))
    return section ? body.trimEnd() + '\n\n' + section : body;
  if (body.split(start).length !== 2 || body.split(end).length !== 2 ||
      body.indexOf(end) < body.indexOf(start))
    throw new Error('Повреждён раздел предпросмотра PR; автоматическое обновление остановлено.');
  const updated = body.slice(0, body.indexOf(start)) +
    (section || '') + body.slice(body.indexOf(end) + end.length);
  return section ? updated : updated.replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function checkWorkingTree(porcelain) {
  const lines = String(porcelain).split(/\r?\n/).filter(Boolean);
  const unexpected = lines.filter(line => !/^\?\? (?:[^/]+\/)*\.DS_Store$/.test(line));
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

export function summarizeReview(pr) {
  const checks = (pr.statusCheckRollup || []).map(x => ({ name: x.name || x.context,
    state: x.status || x.state, conclusion: x.conclusion || null }));
  const checksPending = checks.length === 0 || checks.some(x => {
    if (x.state === 'COMPLETED') return false;
    return !['SUCCESS', 'FAILURE', 'ERROR', 'CANCELLED', 'SKIPPED', 'TIMED_OUT'].includes(x.state);
  });
  const checksFailed = checks.some(x => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(x.conclusion) ||
    ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(x.state));
  const reviews = (pr.comments || []).filter(x => x.body?.includes('<!-- ashen-cloud-review-bot -->'));
  const comment = reviews.at(-1)?.body || null;
  const head = String(pr.headRefOid || '');
  const reviewedSha = comment?.match(/- Коммит:\s*`([0-9a-f]{7,40})`/i)?.[1] || null;
  const currentReview = !!reviewedSha && head.startsWith(reviewedSha);
  const reviewVerdict = checksPending || !currentReview
    ? 'PENDING'
    : (comment?.match(/Облачное ревью PR\s*[—-]\s*(PASS|CHANGES_REQUESTED|BLOCKED)/)?.[1] || 'PENDING');
  const verdict = checksFailed && reviewVerdict === 'PASS' ? 'BLOCKED' : reviewVerdict;
  return { checks, checksFailed, verdict, reviewStale: !!comment && !currentReview,
    reviewerComment: currentReview ? comment?.slice(0, 12000) : null };
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
    ['--test', 'tests/pipeline-v2.test.mjs'],
    ['--test', 'tests/browser-preview-smoke.test.mjs'],
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
  const tablet = tabletPreviewSection(paths, git(['rev-parse', 'HEAD']));
  requireGithubCLI();
  runContracts();
  git(['push', '--set-upstream', 'origin', `HEAD:refs/heads/${name}`]);
  const existing = run('gh', ['pr', 'view', name, '--repo', REPO, '--json', 'number,url,state,body'], { allowFailure: true });
  let result;
  const previous = existing.status === 0 ? JSON.parse(existing.stdout) : null;
  if (isOpenPullRequest(previous)) {
    const updated = replaceTabletPreview(previous.body || '', tablet);
    if (updated !== previous.body) run('gh', ['pr', 'edit', name, '--repo', REPO, '--body', updated]);
    result = previous;
  } else {
    const url = run('gh', ['pr', 'create', '--repo', REPO, '--base', 'main', '--head', name,
      '--title', title, '--body', `${body}\n\n---\nАвтоматически создано Git Operator. CI и независимое ревью обязательны. Merge — только по решению владельца.${tablet ? '\n\n' + tablet : ''}`]).stdout.trim();
    result = { url };
  }
  console.log(JSON.stringify({ operation: 'publish', branch: name, changedFiles: paths, ...result }));
}

function report() {
  const name = validateBranch(branch());
  requireGithubCLI();
  const raw = run('gh', ['pr', 'view', name, '--repo', REPO, '--json', 'number,url,state,headRefOid,statusCheckRollup,comments']).stdout;
  const pr = JSON.parse(raw);
  const { checks, checksFailed, verdict, reviewStale, reviewerComment } = summarizeReview(pr);
  console.log(JSON.stringify({ operation: 'report', branch: name, pr: pr.number, url: pr.url,
    head: pr.headRefOid, state: pr.state, checks, checksFailed, verdict, reviewStale, reviewerComment }));
}

function main() {
  assertRepository();
  const [action, ...args] = process.argv.slice(2);
  if (action === 'status' && args.length === 0) {
    console.log(JSON.stringify({ operation: 'status', branch: branch(), workingTree: git(['status', '--short']) }));
  } else if (action === 'start' && args.length === 0) start(autoBranchName());
  else if (action === 'start' && args.length === 1) start(args[0]);
  else if (action === 'publish' && args.length === 0) publish();
  else if (action === 'report' && args.length === 0) report();
  else throw new Error('Допустимые команды: status | start [branch] | publish | report.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('Git Operator BLOCKED: ' + error.message); process.exitCode = 1; }
}
