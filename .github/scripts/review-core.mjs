// Pure functions used by the cloud reviewer and its offline tests.
export class ReviewBlocked extends Error {}

// Enough room for both reasoning tokens and the final JSON response.
export const MODEL_GENERATION_SETTINGS = Object.freeze({
  max_tokens: 6500,
  reasoning: Object.freeze({ effort: 'low' }),
  temperature: 0,
});

export function ciCommitMatchesHead(runSha, headSha, parents = []) {
  return runSha === headSha || parents.some((parent) => parent.sha === headSha);
}

export function prepareChanges(files, { maxFiles = 35, maxPatchChars = 42000 } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ReviewBlocked('GitHub не вернул изменённых файлов для PR.');
  }
  if (files.length > maxFiles) {
    throw new ReviewBlocked(`В PR ${files.length} файлов (лимит автоматической проверки: ${maxFiles}). Требуется ручная проверка.`);
  }

  let chars = 0;
  const sections = [];
  for (const file of files) {
    if (typeof file.filename !== 'string' || typeof file.patch !== 'string') {
      throw new ReviewBlocked(`Нет текстового diff для ${file.filename || 'неизвестного файла'} (возможно, бинарный файл или слишком большой diff).`);
    }
    const section = `FILE: ${file.filename}\nSTATUS: ${file.status}\n+${file.additions}/-${file.deletions}\n${file.patch}`;
    chars += section.length;
    if (chars > maxPatchChars) {
      throw new ReviewBlocked(`Текст diff превышает ${maxPatchChars} символов. Разделите PR или запросите ручную проверку.`);
    }
    sections.push(section);
  }
  return sections.join('\n\n');
}

export function parseReview(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ReviewBlocked('Модель не вернула текстовый результат.');
  }
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try {
    result = JSON.parse(clean);
  } catch {
    throw new ReviewBlocked('Модель вернула ответ не в формате JSON.');
  }
  if (!result || !['PASS', 'CHANGES_REQUESTED', 'BLOCKED'].includes(result.verdict)) {
    throw new ReviewBlocked('В ответе модели отсутствует допустимый вердикт.');
  }
  if (typeof result.summary !== 'string' || !result.summary.trim() || !Array.isArray(result.findings)) {
    throw new ReviewBlocked('Ответ модели неполон: нужны summary и findings[].');
  }
  const allFindings = result.findings.map((finding) => ({
    severity: ['high', 'medium', 'low'].includes(finding?.severity) ? finding.severity : 'medium',
    file: String(finding?.file ?? '').slice(0, 180),
    problem: String(finding?.problem ?? '').slice(0, 900),
    fix: String(finding?.fix ?? '').slice(0, 900),
  }));
  const severityRank = { high: 0, medium: 1, low: 2 };
  const findings = allFindings
    .map((item, index) => ({ item, index }))
    .sort((a, b) => severityRank[a.item.severity] - severityRank[b.item.severity] || a.index - b.index)
    .slice(0, 15)
    .map(({ item }) => item);
  const manualChecks = Array.isArray(result.manual_checks)
    ? result.manual_checks.slice(0, 8).map((item) => String(item).slice(0, 350))
    : [];
  const hasMaterialFinding = allFindings.some((item) => ['high', 'medium'].includes(item.severity));
  return {
    verdict: result.verdict === 'PASS' && hasMaterialFinding ? 'CHANGES_REQUESTED' : result.verdict,
    summary: result.summary.trim().slice(0, 1900),
    findings,
    manualChecks,
  };
}

export function blockedReview(reason) {
  return { verdict: 'BLOCKED', summary: reason, findings: [], manualChecks: [] };
}

export function renderComment(review, { headSha, ciUrl, model }) {
  const lines = [
    '<!-- ashen-cloud-review-bot -->',
    `## Облачное ревью PR — ${review.verdict}`,
    '',
    review.summary,
    '',
    `- Коммит: \`${headSha.slice(0, 12)}\``,
    `- CI: ${ciUrl ? `[Contract tests](${ciUrl})` : 'результат не найден'}`,
    `- Ревьюер: ${model || 'не запущен'}`,
  ];
  if (review.findings.length) {
    lines.push('', '### Замечания');
    for (const item of review.findings) {
      lines.push(`- **${item.severity}** \`${item.file || 'общая проблема'}\`: ${item.problem}${item.fix ? ` **Исправить:** ${item.fix}` : ''}`);
    }
  }
  if (review.manualChecks.length) {
    lines.push('', '### Проверить вручную');
    for (const check of review.manualChecks) lines.push(`- ${check}`);
  }
  lines.push('', '> Это независимая автоматическая проверка diff, а не одобрение художественной части, геймплея, публикации или merge. Итоговое решение принимает владелец проекта.');
  return lines.join('\n').slice(0, 13500);
}
