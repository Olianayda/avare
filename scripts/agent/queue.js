#!/usr/bin/env node
/**
 * Очередь постов. Хранилище — queue.json рядом с этим файлом.
 *
 *   node queue.js list                 сводка
 *   node queue.js show 3               полный текст поста
 *   node queue.js add '<json>'         добавить черновик (обычно это делает агент)
 *   node queue.js text 3 '<текст>'     записать текст поста, статус → ready
 *   node queue.js image 3 <url>        привязать картинку
 *   node queue.js approve 3            ready → approved
 *   node queue.js posted 3             approved → posted, запись в лог
 *   node queue.js drop 3               убрать черновик
 *
 * Статусы: draft → ready → approved → posted
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'queue.json');
const STATUSES = ['draft', 'ready', 'approved', 'posted'];

function load() {
  if (!fs.existsSync(FILE)) return { items: [], log: [], nextId: 1 };
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(q) {
  fs.writeFileSync(FILE, JSON.stringify(q, null, 2) + '\n');
}

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function find(q, id) {
  const item = q.items.find((i) => String(i.id) === String(id));
  if (!item) die(`Нет записи с номером ${id}`);
  return item;
}

const [, , cmd, ...rest] = process.argv;
const q = load();

switch (cmd) {
  case 'list': {
    if (!q.items.length) {
      console.log('Очередь пуста. Запусти скаут: node scout.js');
      break;
    }
    const order = { approved: 0, ready: 1, draft: 2, posted: 3 };
    const sorted = [...q.items].sort((a, b) => order[a.status] - order[b.status]);
    const counts = {};
    q.items.forEach((i) => (counts[i.status] = (counts[i.status] || 0) + 1));
    console.log(
      STATUSES.filter((s) => counts[s])
        .map((s) => `${s}: ${counts[s]}`)
        .join(' · ') + '\n'
    );
    for (const i of sorted) {
      console.log(`[${i.id}] ${i.status.padEnd(8)} ${i.headline}`);
      console.log(`     ${i.category || '—'} · ${i.source}${i.author ? ' · ' + i.author : ''} · ${i.date || ''}`);
      console.log(`     🔗 ${i.url}`);
      console.log(`     🖼  ${i.image_url || '— картинки нет'}`);
      console.log();
    }
    break;
  }

  case 'show': {
    const i = find(q, rest[0]);
    console.log(`[${i.id}] ${i.status} · ${i.category || '—'}`);
    console.log(`${i.headline}`);
    console.log(`${i.url}\n`);
    console.log(i.post_text || '(текст ещё не написан)');
    if (i.image_url) console.log(`\n🖼  ${i.image_url}`);
    break;
  }

  case 'add': {
    const data = JSON.parse(rest[0] || '{}');
    if (!data.url || !data.headline) die('Нужны как минимум url и headline');
    if (q.items.some((i) => i.url === data.url) || q.log.some((l) => l.url === data.url)) {
      die('Эта новость уже в очереди или уже опубликована');
    }
    const item = {
      id: q.nextId++,
      status: 'draft',
      headline: data.headline,
      url: data.url,
      source: data.source || new URL(data.url).hostname.replace(/^www\./, ''),
      category: data.category || '',
      summary: data.summary || '',
      date: data.date || new Date().toISOString().slice(0, 10),
      post_text: data.post_text || '',
      image_url: data.image_url || '',
      added: new Date().toISOString(),
    };
    if (item.post_text) item.status = 'ready';
    q.items.push(item);
    save(q);
    console.log(`✅ Добавлено [${item.id}] ${item.headline}`);
    break;
  }

  case 'text': {
    const i = find(q, rest[0]);
    const t = rest.slice(1).join(' ');
    if (!t) die('Пустой текст');
    i.post_text = t;
    i.status = 'ready';
    save(q);
    console.log(`✅ [${i.id}] текст записан, статус ready`);
    break;
  }

  case 'image': {
    const i = find(q, rest[0]);
    const url = rest[1];
    if (!url || !/^https:\/\//.test(url)) die('Нужна ссылка на https://');
    i.image_url = url;
    save(q);
    console.log(`✅ [${i.id}] картинка привязана`);
    break;
  }

  case 'approve': {
    const i = find(q, rest[0]);
    if (i.status !== 'ready') die(`Одобрять можно только ready, а тут ${i.status}`);
    if (!i.post_text) die('Нет текста поста');
    i.status = 'approved';
    save(q);
    console.log(`✅ [${i.id}] одобрено`);
    break;
  }

  case 'posted': {
    const i = find(q, rest[0]);
    i.status = 'posted';
    i.posted_date = new Date().toISOString().slice(0, 10);
    q.log.push({ url: i.url, headline: i.headline, posted_date: i.posted_date, category: i.category });
    save(q);
    console.log(`✅ [${i.id}] отмечено опубликованным и записано в лог`);
    break;
  }

  case 'drop': {
    const i = find(q, rest[0]);
    q.items = q.items.filter((x) => x.id !== i.id);
    save(q);
    console.log(`🗑  [${i.id}] убрано`);
    break;
  }

  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 18).join('\n').replace(/^ ?\*ю?\/?/gm, ''));
}
