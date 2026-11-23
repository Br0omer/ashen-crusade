# Pipeline V2 — один чат OpenCode

Pipeline V2 проверен на первых игровых инкрементах. CI не проверяет сам клиент OpenCode, а игровая приёмка остаётся у владельца.

## Роли
Architect — GPT-6.2 Astra (главный чат); Game Designer — Gemini 4 Hydrogen (механики); Developer — Claude Sonnet 5.5 (код); Git Operator — Gemini Hydrogen (чтение); Reviewer + QA — Gemini в GitHub Actions (diff и регрессии). Уже подключённые OpenRouter и GitHub Secret; новые ключи не нужны. Цель — $100/мес., изображения отдельно.

## Один инкремент
1. Architect для игровых идей вызывает Designer, задаёт тебе вопросы в том же чате; для багов дизайнер необязателен.
2. Ты утверждаешь план и разрешаешь ветку, коммит, push рабочей ветки и PR.
3. Architect вызывает точный `git-flow.mjs start` без аргументов: новая `feature/inc-YYYYMMDD-XXXXXXXX` от main. Для ARCH-062 также есть `start test/arch062-swap-fire`.
4. Developer сохраняет `docs/increments/<тип>-<slug>.md` с разделами `## Цель`, `## Критерии приёмки`, `## Проверки` и через `dev-flow.mjs status|check|commit` делает локальный коммит.
5. Architect проверяет результат, вызывает `git-flow.mjs publish` и `report`. CI/Gemini проверяют PR. **Ты решаешь о merge**.

## Границы
- Согласие в чате — не технический `ask`. Вместо него: точный shell allowlist, запрет защищённых файлов, CI и ручной merge.
- Developer не меняет принятые сборки, ART-02, root assets, `.github/`, `.opencode/`, секреты и main. Необходимость такого изменения — BLOCKED.
- Тесты исполняют код ветки (не песочница); CI не заменяет приёмку на Galaxy Tab S9+ с геймпадом. Только облачные LLM, без force-push/rebase/авто-merge.

## Первый сквозной тест
После merge: VS Code → **Git: Pull** → новая сессия Architect. Убедись, что дизайнер вызывается из той же беседы. Далее согласуй регрессионный тест `RB+RT` в одном тике ARCH-062; менять только `tests/` и `docs/increments/`, **не `arch062/`**. До успешного PR, CI и ревью Gemini интеграция Pipeline V2 не считается проверенной.

## Проверка игровых PR на планшете
- `git-flow.mjs publish` добавляет в PR ссылку raw.githack на `prototypes/<slug>/index.html` с полным SHA; при повторном push обновляет или удаляет управляемый раздел ссылки.
- URL по умолчанию **UNVERIFIED**. `Browser preview smoke` в непривилегированном CI открывает реальный Chromium по HTTPS и проверяет загрузку героя, превью, кнопку и игровой старт; HTTP 200 недостаточно. **Игровая приёмка — только у владельца** на Galaxy Tab S9+.
- Gemini рассматривает **весь** diff ограниченными окнами: общий PASS возможен только при успешном ревью каждой части. Ошибка, недоступный patch или превышение ограниченного числа окон — BLOCKED.
- Developer может удалить лишь неотслеживаемый `docs/increments/<текущая-ветка>.md.tmp` командой `node .opencode/scripts/dev-flow.mjs cleanup`; без произвольного удаления.
- После merge инфраструктурного PR повторить ревью старого PR #14 через GitHub Actions → `OpenRouter AI review` → `workflow_dispatch` с номером 14. Старый BLOCKED не исчезает сам.
