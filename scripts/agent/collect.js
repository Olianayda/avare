#!/usr/bin/env node
/**
 * Ежедневный сбор. Запускается launchd, человек не участвует.
 *
 * Забирает свежие статьи из RSS и складывает во «входящие» (inbox.json).
 * Никакой классификации здесь нет намеренно: решать, что релевантно,
 * должен агент, а он читает inbox при следующем разговоре.
 *
 * Сам в queue.json ничего не пишет. Но коммитит то, что туда записала
 * панель, и подтягивает черновики облачной рутины — см. sync().
 *
 * Любой сбой — сигнал человеку (notify.js): уведомление на Mac и сообщение
 * в Telegram. С 29.09 по 08.10 сбор падал каждое утро, а знал об этом
 * только collect.log.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const article = require('./article');
const notify = require('./notify');

const DIR = __dirname;
const ROOT = path.join(DIR, '..', '..');
const INBOX = path.join(DIR, 'inbox.json');
const QUEUE = path.join(DIR, 'queue.json');
const LOG = path.join(DIR, 'collect.log');

const log = (msg) =>
  fs.appendFileSync(LOG, `${new Date().toISOString().slice(0, 19)}  ${msg}\n`);

/** Сбой: в журнал и человеку. Дальше этот прогон не идёт. */
async function alarm(msg) {
  log(`СБОЙ: ${msg}`);
  const problems = await notify(msg);
  if (problems.length) log(`уведомление не дошло: ${problems.join('; ')}`);
  process.exitCode = 1;
}

const run = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { maxBuffer: 8e6 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: stdout || '', out: `${stdout || ''}${stderr || ''}`.trim() })
    )
  );
const git = (...args) => run('git', ['-C', ROOT, ...args]);
const short = (s) => s.split('\n').filter((l) => l && !l.startsWith('hint:')).slice(0, 4).join(' / ');

/** JSON, который не читается, — повод остановиться и сказать, а не падать дальше по цепочке. */
function unreadable(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const markers = /^(<<<<<<<|>>>>>>>)/m.test(text);
    return `${path.basename(file)} не читается (${e.message}).` + (markers ? ' В файле маркеры конфликта git: две версии не свелись.' : '');
  }
}

async function main() {
  const bad = unreadable(QUEUE) || unreadable(INBOX);
  if (bad) return alarm(`${bad} Сбор остановлен: пока файл не починят, новых черновиков не будет.`);

  // process.execPath, а не 'node': у launchd нет /usr/local/bin в PATH.
  const scout = await run(process.execPath, [path.join(DIR, 'scout.js'), '--days', '3', '--json']);
  if (!scout.ok) return alarm(`скаут упал: ${short(scout.out)}`);

  let fresh, broken;
  try {
    ({ fresh, broken } = JSON.parse(scout.stdout));
  } catch (e) {
    return alarm(`не разобрался в выводе скаута: ${e.message}`);
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

  if (added) await grabArticles(inbox, fresh);
  await sync(added);
}

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

/** Незаконченный rebase или merge: кто-то начал сводить версии и бросил. */
function midOperation() {
  const gitDir = path.join(ROOT, '.git');
  return ['rebase-merge', 'rebase-apply', 'MERGE_HEAD'].some((p) => fs.existsSync(path.join(gitDir, p)));
}

/**
 * Обмен с GitHub: отправить входящие, забрать черновики облачной рутины.
 *
 * В main пишет ещё и облачная рутина. Без подтягивания первый же её
 * коммит отбивает наш пуш — и дальше он отбивается каждый день, молча,
 * пока кто-нибудь не заглянет в журнал. Так и вышло: шесть суток сбор
 * работал, а до агента ничего не доезжало.
 *
 * Раньше подтягивали с --autostash: несохранённые правки панели на время
 * прятались в сторону и потом возвращались. 28.09 вернуть не вышло: рутина и
 * панель дописали по посту в одно место, queue.json остался с маркерами
 * конфликта, и сбор лежал девять дней. Теперь:
 *  1. то, что записала панель, коммитится до подтягивания, как обычная правка;
 *  2. queue.json сводит merge-queue.js по смыслу, а не git по строкам;
 *  3. любые другие несохранённые правки — повод остановиться и сказать,
 *     а не прятать их;
 *  4. после подтягивания проверяем, что всё читается, и только тогда пушим.
 */
async function sync(added) {
  const as = ['-c', 'user.name=Avare Collector', '-c', 'user.email=olianayda@gmail.com'];

  if (midOperation()) {
    return alarm('В репозитории не закончено сведение версий (rebase или merge). Сбор не стал его трогать, пуш пропущен.');
  }

  // Входящие и тексты статей. Коммитим всё, что там поменялось, а не только
  // сегодняшнее: если вчерашний коммит не прошёл, он доедет сегодня.
  // Коммит только этих путей: случайно проиндексированное чужое сюда не попадёт.
  const collected = ['scripts/agent/inbox.json', 'scripts/agent/articles'];
  await git('add', ...collected);
  if (!(await git('diff', '--cached', '--quiet', '--', ...collected)).ok) {
    const c = await git(...as, 'commit', '-q', '-m', `Collect: ${added} new in inbox`, '--', ...collected);
    if (!c.ok) return alarm(`коммит входящих не прошёл: ${short(c.out)}`);
  }

  // Что записала панель: статусы, правки текста, картинки, новые черновики.
  if ((await git('status', '--porcelain', '--', 'scripts/agent/queue.json')).out) {
    const bad = unreadable(QUEUE);
    if (bad) return alarm(`${bad} Коммитить такое не стала, пуш пропущен.`);
    const c = await git(...as, 'commit', '-q', '-m', 'Panel: queue state', '--', 'scripts/agent/queue.json');
    if (!c.ok) return alarm(`коммит очереди не прошёл: ${short(c.out)}`);
  }

  const dirty = (await git('diff', '--name-only', 'HEAD')).out;
  if (dirty) {
    const files = dirty.split('\n').join(', ');
    return alarm(
      `В репозитории несохранённые правки: ${files}. Сбор не стал их прятать и подтягивать черновики ` +
        'облачного агента (именно так 28.09 сломалась очередь). Входящие сохранены коммитом на этом Mac ' +
        'и уйдут в GitHub, когда эти правки закоммитят или откатят.'
    );
  }

  const driver = `"${process.execPath}" "${path.join(DIR, 'merge-queue.js')}" %O %A %B`;
  const pull = await git('-c', `merge.avare-queue.driver=${driver}`, 'pull', '--rebase', '-q', 'origin', 'main');
  const merged = pull.out.split('\n').filter((l) => l.startsWith('queue.json'));
  if (merged.length) log(merged.join('; '));
  if (!pull.ok) {
    const network = /Could not read from remote|Connection (closed|reset|refused)|resolve host|timed out|unable to access/i.test(pull.out);
    if (network) return alarm(`GitHub недоступен: ${short(pull.out)}. Входящие сохранены на этом Mac и уйдут при следующем сборе.`);
    const undone = midOperation() ? (await git('rebase', '--abort')).ok : true;
    // Если споткнулся драйвер очереди, его объяснение понятнее вывода git.
    const why = pull.out.split('\n').find((l) => l.startsWith('queue.json не свести')) || short(pull.out);
    return alarm(
      `Не удалось свести изменения с облачным агентом: ${why}. ` +
        (undone
          ? 'Попытку откатила: на этом Mac всё как было, ничего не потеряно. Пуш пропущен, нужна ручная помощь.'
          : 'Откатить попытку не вышло, репозиторий остался посреди rebase. Нужна ручная помощь.')
    );
  }

  const unmerged = (await git('diff', '--name-only', '--diff-filter=U')).out;
  const bad = unreadable(QUEUE) || unreadable(INBOX);
  if (unmerged || bad) return alarm(`После подтягивания что-то не так: ${unmerged ? 'не сведены ' + unmerged : bad}. Пуш пропущен.`);

  if ((await git('rev-list', '--count', 'origin/main..HEAD')).out === '0') return log('с GitHub всё сходится, отправлять нечего');
  const push = await git('push', '-q', 'origin', 'main');
  if (!push.ok) return alarm(`пуш не прошёл: ${short(push.out)}`);
  log('входящие отправлены в репозиторий');
}

main().catch((e) => alarm(`сбор упал: ${short(e.stack || String(e))}`));
