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
const article = require('./article');

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

  if (added === 0) return;
  grabArticles(inbox, fresh).then(() => push(added));
});

/**
 * Скачивает тексты новых статей рядом с входящими.
 *
 * Разбирающий агент живёт в облаке без интернета: egress-прокси песочницы
 * пропускает только api.anthropic.com, npm, pypi и github. Ни curl, ни
 * WebFetch оттуда наружу не ходят. Значит статью должна скачать эта машина,
 * и приехать к агенту она может только через git.
 *
 * Часть изданий отдаёт 403 на серверный запрос. Это их право, обходить не
 * пытаемся: агенту велено пропускать статью, которую не удалось прочитать,
 * а не сочинять факты по заголовку.
 */
async function grabArticles(inbox, fresh) {
  const urls = fresh.map((f) => f.url);
  const items = inbox.items.filter((i) => urls.includes(i.url) && !i.body_file);
  if (!items.length) return;

  fs.mkdirSync(article.DIR, { recursive: true });

  let ok = 0;
  const failed = {};
  // По три за раз: не выстраиваем очередь на десять минут и не долбим издание.
  for (let i = 0; i < items.length; i += 3) {
    await Promise.all(
      items.slice(i, i + 3).map(async (it) => {
        const r = await article.fetchArticle(it.url);
        if (r.error) {
          const host = new URL(it.url).hostname.replace(/^www\./, '');
          failed[host] = (failed[host] || 0) + 1;
          return;
        }
        const name = article.nameFor(it.url);
        fs.writeFileSync(path.join(article.DIR, name), r.text);
        it.body_file = 'articles/' + name;
        ok++;
      })
    );
  }

  const pruned = article.prune();
  fs.writeFileSync(INBOX, JSON.stringify(inbox, null, 2) + '\n');

  const miss = Object.entries(failed).map(([h, n]) => `${h}:${n}`).join(', ');
  log(
    `текстов скачано: ${ok} из ${items.length}` +
      (miss ? `, не отдали: ${miss}` : '') +
      (pruned ? `, вычищено старше ${article.KEEP_DAYS} дн.: ${pruned}` : '')
  );
}

function push(added) {
  const git = (args, done) =>
    execFile('git', ['-C', path.join(DIR, '..', '..'), ...args], (err, stdout, stderr) =>
      done(err, (stdout || '') + (stderr || ''))
    );

  git(['add', 'scripts/agent/inbox.json', 'scripts/agent/articles'], (e1, o1) => {
    if (e1) return log(`git add не прошёл: ${o1.trim()}`);
    const msg = `Collect: ${added} new in inbox`;
    git(['-c', 'user.name=Avare Collector', '-c', 'user.email=olianayda@gmail.com', 'commit', '-q', '-m', msg], (e2, o2) => {
      if (e2) return log(`коммит не прошёл: ${o2.trim()}`);
      git(['push', '-q', 'origin', 'main'], (e3, o3) =>
        log(e3 ? `пуш не прошёл: ${o3.trim()}` : 'входящие отправлены в репозиторий')
      );
    });
  });
}
