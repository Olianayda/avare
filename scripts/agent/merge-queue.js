#!/usr/bin/env node
/**
 * Сводит две версии queue.json по смыслу, а не по строкам. git зовёт его сам,
 * когда очередь поменяли с двух сторон: панель на этом Mac и облачная рутина.
 *
 *   .gitattributes:  scripts/agent/queue.json merge=avare-queue
 *   git config merge.avare-queue.driver "node scripts/agent/merge-queue.js %O %A %B"
 *
 * Построчное слияние git для этого файла почти всегда даёт конфликт: обе
 * стороны дописывают посты в конец одного массива. По смыслу же они почти
 * никогда не спорят. 28.09 так и вышло: панель и рутина дали номер 33 двум
 * разным постам, файл остался с маркерами конфликта, сбор лежал девять дней.
 *
 * Посты сводятся по ссылке на статью (url):
 *  - пост появился с одной стороны: берём;
 *  - пост убрали с одной стороны: убираем;
 *  - поле поменяли с одной стороны: берём изменение;
 *  - статус поменяли обе: берём дальний по пути draft → ready → approved → posted;
 *  - одно поле поменяли обе и по-разному: не угадываем. Отдаём git обычный
 *    конфликт с маркерами, сбор откатит попытку и пришлёт сигнал.
 * Номера после сведения уникальны: прежние посты номер сохраняют, а новый пост,
 * чей номер заняла другая сторона, получает следующий свободный.
 *
 * Код выхода 0 — свели, результат записан в %A; 1 — нужен человек.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

const RANK = { draft: 0, ready: 1, approved: 2, rejected: 2, posted: 3 };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

class Conflict extends Error {}

/** Трёхстороннее слияние одного объекта по полям. */
function mergeFields(o, a, b, what) {
  const r = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const [va, vb, vo] = [a[k], b[k], o[k]];
    let v;
    if (same(va, vb) || same(vb, vo)) v = va;
    else if (same(va, vo)) v = vb;
    else if (k === 'status' && RANK[va] !== RANK[vb]) v = RANK[va] > RANK[vb] ? va : vb;
    else throw new Conflict(`${what}: поле «${k}» изменено с обеих сторон по-разному`);
    if (v !== undefined) r[k] = v;
  }
  return r;
}

function mergeQueue(base, a, b) {
  const notes = [];
  const byUrl = (q) => new Map((q.items || []).map((i) => [i.url, i]));
  const [O, A, B] = [byUrl(base), byUrl(a), byUrl(b)];

  // Порядок: как у первой стороны, потом новое со второй.
  const urls = [...A.keys(), ...[...B.keys()].filter((u) => !A.has(u))];
  const items = [];
  for (const url of urls) {
    const [o, x, y] = [O.get(url), A.get(url), B.get(url)];
    const what = `пост «${(x || y).headline}»`;
    if (o && (!x || !y)) continue; // убрали с одной из сторон
    let item;
    if (x && y) {
      if (o) item = mergeFields(o, x, y, what);
      else if (same(x, y)) item = x;
      else if (RANK[x.status] !== RANK[y.status]) item = RANK[x.status] > RANK[y.status] ? x : y;
      else throw new Conflict(`${what}: добавлен с обеих сторон в разном виде`);
    } else item = x || y;
    items.push({ item, side: o ? 'base' : x ? 'a' : 'b' });
  }

  // Номера: сначала свои сохраняют прежние посты, потом новые первой стороны,
  // потом новые второй. Кому номер не достался, получает следующий свободный.
  const used = new Set();
  const later = [];
  for (const side of ['base', 'a', 'b']) {
    for (const e of items.filter((e) => e.side === side)) {
      if (used.has(e.item.id)) later.push(e);
      else used.add(e.item.id);
    }
  }
  let next = Math.max(0, ...used, (a.nextId || 1) - 1, (b.nextId || 1) - 1) + 1;
  for (const e of later) {
    notes.push(`«${e.item.headline}»: номер ${e.item.id} занят, стал ${next}`);
    e.item = { ...e.item, id: next++ };
  }

  const result = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'items') result.items = items.map((e) => e.item);
    else if (k === 'log') {
      const key = (l) => `${l.url}|${l.posted_date}`;
      const seen = new Set((a.log || []).map(key));
      result.log = [...(a.log || []), ...(b.log || []).filter((l) => !seen.has(key(l)))];
    } else if (k === 'dismissed') result.dismissed = [...new Set([...(a.dismissed || []), ...(b.dismissed || [])])];
    else if (k === 'nextId') result.nextId = next;
    else Object.assign(result, mergeFields({ [k]: base[k] }, { [k]: a[k] }, { [k]: b[k] }, 'очередь'));
  }

  const added = (side) => items.filter((e) => e.side === side).length;
  notes.unshift(`queue.json сведён автоматически: новых постов ${added('a')} + ${added('b')}`);
  return { result, notes };
}

module.exports = { mergeQueue, Conflict };

if (require.main === module) {
  const [O, A, B] = process.argv.slice(2);
  try {
    const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const { result, notes } = mergeQueue(read(O), read(A), read(B));
    fs.writeFileSync(A, JSON.stringify(result, null, 2) + '\n');
    console.error(notes.join('; '));
  } catch (e) {
    // Не смогли по смыслу — отдаём обычный построчный конфликт, как сделал бы git.
    console.error(`queue.json не свести автоматически: ${e.message}`);
    try {
      execFileSync('git', ['merge-file', '-L', 'эта сторона', '-L', 'общий предок', '-L', 'другая сторона', A, O, B]);
    } catch {}
    process.exitCode = 1;
  }
}
