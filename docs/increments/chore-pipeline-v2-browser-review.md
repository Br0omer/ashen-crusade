# Pipeline V2 — browser previews and bounded cloud review

## Цель
Устранить блокировку больших игровых PR при ревью и обеспечить безопасную ссылку для проверки сборок на планшете.

## Критерии приёмки
- Не меняются принятые сборки, включая arch062/, art02 и прототип B1 PR #14.
- Gemini получает полный diff крупного PR через последовательные окна; любой сбой или замечание сохраняет блокировку merge. Лимит запросов ограничен.
- Для игрового PR с prototypes/<slug>/ создаётся SHA-зависимая HTTPS-ссылка в описании PR, обновляется при изменении SHA без изменения остальных разделов.
- Отдельный непривилегированный CI smoke-test использует Chromium на HTTPS-странице, проверяет загрузку героя, Canvas-превью, активную кнопку и переход к игре. Проверка доступности файлов не подменяет браузерную проверку.
- Developer может удалить только свой маленький неотслеживаемый docs/increments/*.md.tmp через явную фиксированную команду.
- Merge и игровая приёмка исключительно вручную, без изменений секретов и конфигурации публикации.

## Проверки
- node tests/arch061-contract.cjs
- node tests/arch062-contract.cjs
- node --test tests/openrouter-review.test.mjs
- node --test tests/git-flow.test.mjs
- node --test tests/pipeline-v2.test.mjs
- node --test tests/browser-preview-smoke.test.mjs
- GitHub Actions: Contract tests, Browser preview smoke (если PR меняет prototype)
- Облачное ревью Gemini для SHA PR; после merge ручной workflow_dispatch повторно проверит B1 PR #14.
