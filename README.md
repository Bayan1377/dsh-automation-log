# dsh-automation-log

Лента автоматизаций в левой панели DeepSeek Harness. Отвечает на два вопроса сразу:
что в последнее время запускал планировщик DSH и что делали локальные наблюдатели.

## Что показывает

- **Последние запуски задач планировщика** — время, статус (`активна` / `на паузе` /
  `завершена`), по клику открывается чат, в который пришёл запуск.
- **События наблюдателей** — строки, которые локальные скрипты дописывают в
  `%USERPROFILE%\.dsh\watch-events.ndjson`. Это необязательная половина: без файла
  панель просто показывает только запуски задач.
- Лента обновляется сама каждые 20 секунд и хранит 30 последних строк. Есть кнопка
  «Обновить», состояния «Загружаю…» и «Пока не было запусков…».

## Установка

Нужны Node.js 20+ и `pnpm` (DSH ставит плагины через него):

```powershell
dsh plugin --profile desktop add dsh-automation-log
```

Обновление установленной версии — двумя шагами, `add` поверх уже стоящего пакета
DSH отклонит:

```powershell
dsh plugin --profile desktop remove dsh-automation-log
dsh plugin --profile desktop add dsh-automation-log
```

После установки перезапустите DSH: плагин добавляет строку в левую панель через
`@deepseek-ai/dsh-client-ui-sidebar`.

## Формат журнала наблюдателей (необязательно)

NDJSON, одна строка — одно событие. Читаются поля `ts`, `watcher`, `action`, `title`,
`detail`, `status`; строки без `ts` и `title` пропускаются, битая строка не скрывает
остальные. `status`: `ok` / `info` / `warn` / `error`.

```json
{"ts":"2026-11-13T09:00:00+04:00","watcher":"tv","action":"slot-start","title":"ТВ включён, показ идёт","detail":"07:45","status":"ok"}
```

Хосту добавлен один маршрут только для чтения:
`GET /automation-log/watch-events` → `{ ok: true, events: [...] }`. Плагин ничего не
запускает и не меняет.

## Устройство

- `lib/index.js` — хост: читает журнал наблюдателей и отдаёт его по HTTP.
- `lib/client.js` — браузерная половина: строка в сайдбаре, опрос раз в 20 с, рендер.
- `cordis.patch.yml` — вставка плагина в стек слоёв профиля (лежит в пакете, чтобы
  обновление Harness не потеряло запись).

## Выключить

```powershell
dsh plugin --profile desktop remove dsh-automation-log
```

## Лицензия

MIT.

---

English: automations feed for the DSH left sidebar — recent schedule runs plus optional
local watcher events from `~/.dsh/watch-events.ndjson`, click a row to open the chat.
