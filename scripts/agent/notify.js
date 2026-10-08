#!/usr/bin/env node
/**
 * Сигнал человеку, что сбор сломался. Раньше сбой было видно только в
 * collect.log, и с 29.09 по 08.10 его не видел никто.
 *
 * Два канала, каждый срабатывает независимо от другого:
 *  - уведомление macOS: видно сразу, если сидишь за Mac;
 *  - личное сообщение от бота Avare в Telegram: доходит на телефон.
 *
 * Настройки Telegram лежат в scripts/agent/.notify.local.json (файл в
 * .gitignore: репозиторий публичный):
 *   { "telegram_chat_id": "…", "telegram_bot_config": "/…/lead-tracker/telegram/config.json" }
 * Токен бота сюда не копируем: берём из конфига бота, где он уже лежит.
 *
 *   node notify.js "текст"      проверить оба канала руками
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TITLE = 'Avare: сбор новостей';
const LOCAL = path.join(__dirname, '.notify.local.json');

function mac(text) {
  // Текст передаём аргументом, а не вклеиваем в скрипт: кавычки в нём не сломают AppleScript.
  return new Promise((resolve) =>
    execFile(
      'osascript',
      ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv) sound name "Basso"', '-e', 'end run', text.slice(0, 400), TITLE],
      (err) => resolve(err ? `mac: ${err.message.trim()}` : null)
    )
  );
}

async function telegram(text) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
  } catch {
    return 'telegram: нет scripts/agent/.notify.local.json';
  }
  let token;
  try {
    token = JSON.parse(fs.readFileSync(cfg.telegram_bot_config, 'utf8')).token;
  } catch (e) {
    return `telegram: не читается конфиг бота ${cfg.telegram_bot_config}`;
  }
  if (!token || !cfg.telegram_chat_id) return 'telegram: нет токена или chat_id';

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text: `${TITLE}\n\n${text}`.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    return j.ok ? null : `telegram: ${j.description || 'HTTP ' + res.status}`;
  } catch (e) {
    return `telegram: ${e.message}`;
  }
}

/** Никогда не бросает: сбой уведомления не должен ронять сбор. → список проблем каналов. */
async function notify(text) {
  return (await Promise.all([mac(text), telegram(text)])).filter(Boolean);
}

module.exports = notify;

if (require.main === module) {
  notify(process.argv.slice(2).join(' ') || 'Проверка уведомлений: если видно это сообщение, канал работает.').then((problems) => {
    console.log(problems.length ? problems.join('\n') : 'Оба канала отработали.');
    process.exitCode = problems.length ? 1 : 0;
  });
}
