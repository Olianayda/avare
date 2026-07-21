#!/usr/bin/env node
/**
 * Скаут: обходит RSS-источники, отбрасывает всё, что уже было в работе,
 * и печатает новые статьи-кандидаты.
 *
 *   node scout.js              # за последние 7 дней
 *   node scout.js --days 14
 *   node scout.js --json       # машинный вывод
 *
 * Классификацию (релевантно / нет, категория) делает сам агент, читая этот
 * вывод. Отдельный вызов AI-модели не нужен — это экономит и деньги, и ключи.
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SOURCES = path.join(DIR, 'sources.json');
const QUEUE = path.join(DIR, 'queue.json');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const has = (n) => process.argv.includes(`--${n}`);

const DAYS = parseInt(arg('days') || '7', 10);
const AS_JSON = has('json');

function loadQueue() {
  if (!fs.existsSync(QUEUE)) return { items: [], log: [] };
  return JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
}

// Нормализуем ссылку, чтобы utm-хвосты не ломали дедупликацию.
function normUrl(u) {
  try {
    const url = new URL(u);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    // Atom кладёт ссылку в атрибут href, RSS — в тело тега.
    let link = tag(b, 'link');
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      link = m ? m[1] : '';
    }
    const dateRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');

    // Автор: RSS кладёт в dc:creator, Atom — во вложенный <author><name>.
    let author = tag(b, 'dc:creator') || tag(b, 'author');
    const atomName = b.match(/<author[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i);
    if (atomName) author = decode(atomName[1]);
    // Отсечь почтовый формат вида "mail@example.com (Имя)".
    const paren = author && author.match(/\(([^)]+)\)\s*$/);
    if (paren) author = paren[1];

    return {
      headline: tag(b, 'title'),
      url: link,
      author: (author || '').trim(),
      summary: (tag(b, 'description') || tag(b, 'summary') || '').slice(0, 400),
      date: dateRaw ? new Date(dateRaw) : null,
    };
  });
}

async function fetchFeed(src) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(src.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
    });
    if (!res.ok) return { src, error: `HTTP ${res.status}` };
    return { src, items: parseFeed(await res.text()) };
  } catch (e) {
    return { src, error: e.name === 'AbortError' ? 'таймаут' : e.message };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const { feeds } = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
  const q = loadQueue();

  // Всё, что уже видели: и в очереди, и в опубликованном.
  const seen = new Set([...q.items, ...q.log].map((i) => normUrl(i.url)));

  const cutoff = new Date(Date.now() - DAYS * 864e5);
  const results = await Promise.all(feeds.map(fetchFeed));

  const fresh = [];
  const broken = [];

  for (const r of results) {
    if (r.error) {
      broken.push(`${r.src.name}: ${r.error}`);
      continue;
    }
    for (const it of r.items) {
      if (!it.url || !it.headline) continue;
      if (it.date && it.date < cutoff) continue;
      const key = normUrl(it.url);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({
        headline: it.headline,
        url: it.url,
        summary: it.summary,
        source: r.src.name,
        author: it.author || "",
        date: it.date ? it.date.toISOString().slice(0, 10) : '',
      });
    }
  }

  fresh.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (AS_JSON) {
    console.log(JSON.stringify({ fresh, broken }, null, 2));
    return;
  }

  console.log(`Свежих статей за ${DAYS} дн.: ${fresh.length}\n`);
  fresh.forEach((f, i) => {
    console.log(`[${i + 1}] ${f.headline}`);
    console.log(`    ${f.source}${f.author ? ' · ' + f.author : ''} · ${f.date || 'без даты'}`);
    console.log(`    ${f.url}`);
    if (f.summary) console.log(`    ${f.summary.slice(0, 180)}`);
    console.log();
  });
  if (broken.length) {
    console.log('Недоступные источники:');
    broken.forEach((b) => console.log(`  ⚠️  ${b}`));
  }
})();
