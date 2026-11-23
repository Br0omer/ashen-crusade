# Pipeline V2 — tablet previews and cloud review

## Цель
Безопасно публиковать SHA-ссылку на игровой прототип и полноценно проверять большие PR без изменения принятых сборок.

## Критерии приёмки
- Для prototypes/<slug>/ ссылка в PR указывает на полный SHA, обновляется при push и удаляется при удалении прототипа.
- CI Chromium проверяет HTTPS-загрузку героя, Canvas-превью, доступность старта и запуск без ошибок JS/сети.
- Gemini проверяет весь diff по ограниченным окнам; любой сбой/замечание блокирует общий PASS.
- Developer удаляет только свой маленький неотслеживаемый .md.tmp. Игровая приёмка и merge — у владельца.
- arch062/, принятые сборки, B1 PR #14, секреты и настройки Pages не изменяются.

## Проверки
- Существующие ARCH-061/ARCH-062 контракты; reviewer/git-flow/pipeline unit tests.
- Новые offline smoke/preview/cleanup тесты; GitHub CI и ревью Gemini.
- Browser smoke на первом игровом PR, повторный workflow_dispatch ревью PR #14 после merge.
