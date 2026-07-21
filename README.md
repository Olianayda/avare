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
- `scripts/post-linkedin.sh` — отправка поста с проверкой картинки на 200
- `skills/avare-news-posts.md` — правила написания постов

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

## Железные правила постов

MAKSA не упоминается. Новость не пересказывается — 80% содержание статьи,
наш голос только последним абзацем и вопросом. Атрибуция автора и издания
обязательна. Цифры только настоящие. Подробности в `skills/avare-news-posts.md`.
