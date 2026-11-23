import { blockedReview, buildReviewMessages, ciCommitMatchesHead, describeOpenRouterFailure, isReviewableSourcePath, MODEL_GENERATION_SETTINGS, parseReview, prepareReviewChunks, combineReviewChunks, renderComment, ReviewBlocked } from './review-core.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_REVIEW_MODEL;
const eventPath = process.env.GITHUB_EVENT_PATH;
const manualPrNumber = Number(process.env.REVIEW_PR_NUMBER || 0);

if (!repo || !token || !eventPath || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_TOKEN или GITHUB_EVENT_PATH не настроены.');
}

const [owner, repoName] = repo.split('/');
const prefix = `/repos/${owner}/${repoName}`;
const { readFile } = await import('node:fs/promises');
const event = JSON.parse(await readFile(eventPath, 'utf8'));

async function github(path, options = {}) {
  const url = `https://api.github.com${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} (${path.split('?')[0]})`);
  return response.status === 204 ? null : response.json();
}

async function findPullRequestNumber() {
  if (manualPrNumber) return manualPrNumber;
  if (event.workflow_run?.event !== 'pull_request') return null;

  const fromEvent = event.workflow_run.pull_requests || [];
  if (fromEvent.length === 1) return fromEvent[0].number;

  // Some workflow_run payloads omit pull_requests; only consider open same-repo PRs.
  const candidates = await github(`${prefix}/pulls?state=open&per_page=100`);
  const matches = candidates.filter((pr) =>
    pr.head.repo?.full_name === repo &&
    (pr.head.sha === event.workflow_run.head_sha || pr.head.ref === event.workflow_run.head_branch));
  return matches.length === 1 ? matches[0].number : null;
}

async function getAllChangedFiles(prNumber) {
  const files = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await github(`${prefix}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) return files;
  }
  throw new ReviewBlocked('PR содержит более 300 файлов. Нужна ручная проверка.');
}

async function ciRunCoversCurrentHead(run, pr) {
  if (ciCommitMatchesHead(run.head_sha, pr.head.sha)) return true;
  if (!/^[0-9a-f]{40}$/.test(run.head_sha || '')) return false;
  try {
    // pull_request CI tests refs/pull/N/merge: head_sha is a *merge commit*,
    // not the PR head SHA. Its parent must be the current PR head commit.
    const commit = await github(`${prefix}/git/commits/${run.head_sha}`);
    return ciCommitMatchesHead(run.head_sha, pr.head.sha, commit.parents || []);
  } catch (error) {
    console.log(`Не удалось проверить SHA merge-commit для CI: ${error.message}`);
    return false;
  }
}

async function getCi(pr) {
  if (event.workflow_run) {
    const run = event.workflow_run;
    // Never report CI from an older PR head as a test of the current commit.
    const linked = (run.pull_requests || []).find((candidate) => candidate.number === pr.number);
    if ((run.pull_requests || []).length && !linked) {
      return { conclusion: 'unverified', url: run.html_url };
    }
    if (!(await ciRunCoversCurrentHead(run, pr))) {
      return { conclusion: 'stale', url: run.html_url };
    }
    return { conclusion: run.conclusion, url: run.html_url };
  }

  // Manual rechecks are permitted only when the corresponding PR CI is verified.
  const runs = await github(`${prefix}/actions/runs?event=pull_request&branch=${encodeURIComponent(pr.head.ref)}&per_page=50`);
  let matching;
  for (const run of runs.workflow_runs || []) {
    if (run.name !== 'Contract tests') continue;
    if ((run.pull_requests || []).length && !(run.pull_requests || []).some((candidate) => candidate.number === pr.number)) continue;
    if (await ciRunCoversCurrentHead(run, pr)) {
      matching = run;
      break;
    }
  }
  return matching
    ? { conclusion: matching.conclusion || 'pending', url: matching.html_url }
    : { conclusion: 'unverified', url: '' };
}

async function readChangedTextFile(path, ref) {
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  const data = await github(`${prefix}/contents/${safePath}?ref=${encodeURIComponent(ref)}`);
  if (data.type !== 'file' || data.encoding !== 'base64' || data.size > 9500) return null;
  const body = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
  return body.includes('\u0000') ? null : body;
}

async function sourceContext(files, pr) {
  const sources = [];
  let total = 0;
  const candidates = files.filter((file) =>
    file.status !== 'removed' && isReviewableSourcePath(file.filename));
  // Approved increment specs must not be dropped when a PR changes many files.
  candidates.sort((a, b) =>
    Number(/^docs\/increments\/[^/]+\.md$/.test(b.filename)) -
    Number(/^docs\/increments\/[^/]+\.md$/.test(a.filename)));
  for (const file of candidates.slice(0, 7)) {
    try {
      const body = await readChangedTextFile(file.filename, pr.head.sha);
      if (!body || total + body.length > 14000) continue;
      sources.push(`FILE: ${file.filename}\n${body}`);
      total += body.length;
    } catch (error) {
      console.log(`Не удалось прочитать связанный файл ${file.filename}: ${error.message}`);
    }
  }
  return sources.join('\n\n');
}

async function requestReview(pr, files, diff, context, part, totalParts) {
  const [agents, roadmap, releases] = await Promise.all([
    readFile('AGENTS.md', 'utf8'),
    readFile('docs/roadmap.md', 'utf8'),
    readFile('docs/releases.md', 'utf8'),
  ]);
  const messages = buildReviewMessages({ pr, files, diff, sources: context, agents, roadmap, releases });
  // The model sees only its bounded window; aggregation runs only after all windows return.
  const payload = JSON.parse(messages[1].content);
  payload.reviewWindow = { index: part, total: totalParts, scope: 'Review ALL included diff lines, do not assume other windows passed.' };
  messages[1].content = JSON.stringify(payload);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Br0omer/ashen-crusade',
      'X-Title': 'Ashen Crusade PR reviewer',
    },
    // Reasoning tokens share max_tokens with visible output on many models.
    // A small budget can yield finish_reason=length and completely empty content.
    body: JSON.stringify({
      model,
      messages,
      ...MODEL_GENERATION_SETTINGS,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new ReviewBlocked(describeOpenRouterFailure(response.status, errorBody));
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter((part) => typeof part.text === 'string').map((part) => part.text).join('')
    : '';
  if (!text.trim()) {
    const finish = String(data.choices?.[0]?.finish_reason || 'unknown');
    const used = data.usage?.completion_tokens;
    const reasoningUsed = data.usage?.completion_tokens_details?.reasoning_tokens;
    throw new ReviewBlocked(
      `OpenRouter вернул пустой текст (finish_reason=${finish}, output_tokens=${used ?? 'unknown'}, ` +
      `reasoning_tokens=${reasoningUsed ?? 'unknown'}). Возможно, токены потрачены на рассуждение; ` +
      'проверьте ограничения модели или выберите другую модель ревьюера.',
    );
  }
  return parseReview(text);
}

async function publish(pr, review, ci) {
  const comment = renderComment(review, { headSha: pr.head.sha, ciUrl: ci.url, model: model && apiKey ? model : '' });
  const comments = await github(`${prefix}/issues/${pr.number}/comments?per_page=100`);
  const previous = comments.find((item) => item.user?.login === 'github-actions[bot]' &&
    item.body?.includes('<!-- ashen-cloud-review-bot -->'));
  if (previous) {
    await github(`${prefix}/issues/comments/${previous.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: comment }) });
  } else {
    await github(`${prefix}/issues/${pr.number}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: comment }) });
  }
  await github(`${prefix}/check-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'OpenRouter AI review',
      head_sha: pr.head.sha,
      status: 'completed',
      conclusion: review.verdict === 'PASS' ? 'success' : review.verdict === 'CHANGES_REQUESTED' ? 'failure' : 'action_required',
      output: { title: `Облачное ревью: ${review.verdict}`, summary: comment.slice(0, 7000) },
    }),
  });
  console.log(`PR #${pr.number}: ${review.verdict}; проверен коммит ${pr.head.sha}`);
}

const prNumber = await findPullRequestNumber();
if (!prNumber) {
  console.log('Связанный PR не определён однозначно; облачное ревью пропущено.');
  process.exit(0);
}
const pr = await github(`${prefix}/pulls/${prNumber}`);
if (pr.state !== 'open' || pr.draft || pr.head.repo?.full_name !== repo || pr.base.ref !== 'main') {
  console.log('Ревью запускается только для открытого PR из ветки этого репозитория в main.');
  process.exit(0);
}
const ci = await getCi(pr);
let review;
if (ci.conclusion !== 'success') {
  review = blockedReview(`CI не подтверждён как успешный для текущего PR (статус: ${ci.conclusion}). Сначала проверьте Contract tests.`);
} else if (!apiKey || !model) {
  review = blockedReview('Не настроены GitHub Secret OPENROUTER_API_KEY и/или Repository variable OPENROUTER_REVIEW_MODEL.');
} else {
  try {
    const files = await getAllChangedFiles(pr.number);
    const windows = prepareReviewChunks(files);
    const context = await sourceContext(files, pr);
    const results = [];
    for (let i = 0; i < windows.length; i++) {
      try {
        results.push(await requestReview(pr, windows[i].files, windows[i].diff, context, i + 1, windows.length));
      } catch (error) {
        // Fail closed: one rejected/unfinished review cannot turn the full PR green.
        results.push(blockedReview('Окно ' + (i + 1) + '/' + windows.length + ': ' +
          (error instanceof ReviewBlocked ? error.message : 'незавершённое ревью')));
        break;
      }
      if (results.at(-1).verdict === 'BLOCKED') break;
    }
    review = combineReviewChunks(results);
    if (results.length !== windows.length && review.verdict !== 'BLOCKED')
      review = blockedReview('Не все окна diff проверены.');
  } catch (error) {
    review = blockedReview(error instanceof ReviewBlocked ? error.message : `Ревью не выполнено: ${error.message}`);
  }
}
// A new push during a multi-window review must not produce an approval for an older head.
const latestPr = await github(`${prefix}/pulls/${pr.number}`);
if (latestPr.head.sha !== pr.head.sha) {
  console.log('PR head изменился во время независимого ревью; старый SHA не публикуем.');
  process.exit(0);
}
await publish(pr, review, ci);
