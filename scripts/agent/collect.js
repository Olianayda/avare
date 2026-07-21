#!/usr/bin/env node
/**
 * Ежедневный сбор. Запускается launchd, человек не участвует.
 *
 * Забирает свежие статьи из RSS и складывает во «входящие» (inbox.json).
 * Никакой классификации здесь нет намеренно: решать, что релевантно,
 * должен агент, а он читает inbox при следующем разговоре.
 *
 * В queue.json ничего не пишется — панель остаётся чистой.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const INBOX = path.join(DIR, 'inbox.json');
const LOG = path.join(DIR, 'collect.log');

const log = (msg) =>
  fs.appendFileSync(LOG, `${new Date().toISOString().slice(0, 19)}  ${msg}\n`);

// process.execPath, а не 'node': у launchd нет /usr/local/bin в PATH.
execFile(process.execPath, [path.join(DIR, 'scout.js'), '--days', '3', '--json'], { maxBuffer: 8e6 }, (err, stdout) => {
  if (err) return log(`ошибка скаута: ${err.message}`);

  let fresh, broken;
  try {
    ({ fresh, broken } = JSON.parse(stdout));
  } catch (e) {
    return log(`не разобрался в выводе скаута: ${e.message}`);
  }

  const inbox = fs.existsSync(INBOX) ? JSON.parse(fs.readFileSync(INBOX, 'utf8')) : { items: [] };
  const seen = new Set(inbox.items.map((i) => i.url));

  let added = 0;
  for (const f of fresh) {
    if (seen.has(f.url)) continue;
    inbox.items.push({ ...f, collected: new Date().toISOString().slice(0, 10) });
    added++;
  }

  // Не даём файлу расти бесконечно: держим последние 400 записей.
  if (inbox.items.length > 400) inbox.items = inbox.items.slice(-400);

  fs.writeFileSync(INBOX, JSON.stringify(inbox, null, 2) + '\n');
  log(`новых: ${added}, всего во входящих: ${inbox.items.length}` + (broken?.length ? `, недоступны: ${broken.join('; ')}` : ''));
});
