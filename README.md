# Avare News Agent

Агент для страницы компании Avare BioTech в LinkedIn. Собирает отраслевые
новости, помогает отобрать лучшие и публикует их как независимый комментарий —
не пересказ. Продукт MAKSA в этих постах не упоминается.

## Как устроено

```
collect.js  ежедневно (launchd) тянет RSS → inbox.json (входящие, сырое)
    ↓
человек + агент отбирают релевантное → queue.json (очередь)
    ↓
server.js   локальная панель http://localhost:4321 для отбора и правки
    ↓
post-linkedin.sh   отправка одобренного в Make → LinkedIn
```

Публикация и отбор разведены намеренно: ни один автомат не постит сам.
Точка утверждения человеком — обязательна.

## Файлы

- `scripts/agent/scout.js` — читает RSS из `sources.json`, дедуплицирует по `queue.json`
- `scripts/agent/collect.js` — ежедневный сбор во `inbox.json`
- `scripts/agent/queue.js` — CLI очереди (draft → ready → approved → posted)
- `scripts/agent/server.js` — веб-панель отбора
- `scripts/agent/post-rules.js` — проверка поста по механическим правилам (длина, MAKSA, тире…)
- `scripts/agent/merge-queue.js` — сводит две версии `queue.json` (панель и облачная рутина) по смыслу
- `scripts/agent/notify.js` — сигнал о сбое сбора: уведомление на Mac и в Telegram
- `scripts/post-linkedin.sh` — отправка поста с проверкой картинки на 200
- `skills/avare-news-posts.md` — правила написания постов, единственная копия
  (глобальный скил `~/.claude/skills/avare-news-posts/SKILL.md` — ссылка сюда)
- `prompts/triage.md` — копия промпта облачной рутины, которая пишет черновики

## Состояние

- `queue.json` — очередь постов, источник правды
- `inbox.json` — входящие после сбора, до отбора

## Запуск

```
node scripts/agent/scout.js --days 7      # что нового
node scripts/agent/server.js              # панель отбора
node scripts/agent/collect.js             # разовый сбор
```

Зависимостей нет: только Node 18+ (встроенный fetch), curl и python3 для отправки.

## Если сбор сломался

Сбор сам пишет в `scripts/agent/collect.log` и при любом сбое шлёт сигнал:
уведомление на Mac и личное сообщение от бота Avare в Telegram. Куда слать —
в `scripts/agent/.notify.local.json` (не в git), проверить: `node scripts/agent/notify.js`.

Правки панели сбор не прячет: коммитит их как «Panel: queue state», потом
подтягивает черновики облачной рутины. Чтобы `queue.json` сводился по смыслу и
при ручном `git pull`, в новом клоне один раз:

```
git config merge.avare-queue.driver "node scripts/agent/merge-queue.js %O %A %B"
```

## Железные правила постов

MAKSA не упоминается. Новость не пересказывается — 80% содержание статьи,
наш голос только последним абзацем и вопросом. Атрибуция автора и издания
обязательна. Цифры только настоящие. Подробности в `skills/avare-news-posts.md`.
