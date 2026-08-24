#!/usr/bin/env node
/**
 * Скачивание статьи и извлечение текста.
 *
 * Живёт здесь, а не в облаке, по простой причине: у разбирающего агента нет
 * интернета. Egress-прокси песочницы пропускает только api.anthropic.com,
 * npm, pypi и github — ни curl, ни WebFetch наружу не ходят. Поэтому статью
 * скачивает эта машина, а агент читает готовый текст из репозитория.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'articles');
// Через два месяца текст уже не нужен: разбирают за последние двое суток,
// остальное лежит на случай «вернуться к теме». Дальше это просто вес в git.
const KEEP_DAYS = 60;

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

/** Имя файла из url: стабильное, короткое, без сюрпризов файловой системы. */
function nameFor(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.txt';
}

/**
 * Вытаскивает текст статьи. Сначала ищем осмысленный контейнер — <article>
 * или main. Если его нет, берём всё тело, но тогда в текст попадут меню и
 * подвал: у наивной очистки первые пара тысяч символов — навигация сайта.
 */
function extract(html) {
  const strip = (s) =>
    decode(
      s
        .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/We use cookies[\s\S]{0,300}?Cookie Policy\s*\.?/i, ' ')
      .replace(/(?:\bAdvertisement\b\s*){2,}/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*class="[^"]*(?:article-body|entry-content|post-content|story-body)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer)/i,
  ];

  for (const re of candidates) {
    const m = html.match(re);
    if (m) {
      const txt = strip(m[1]);
      // Слишком короткий контейнер — скорее всего попали в анонс, а не в статью.
      if (txt.length > 600) return txt;
    }
  }
  return strip(html.replace(/[\s\S]*?<body[^>]*>/i, ''));
}

async function fetchArticle(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Без внятного User-Agent часть изданий отдаёт заглушку вместо статьи.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const html = await r.text();
    const text = extract(html);
    if (text.length < 600) return { error: `текст ${text.length} симв — похоже на заглушку` };

    // Проверка на длину пайволл не ловит: страница-заглушка набирает те же
    // несколько тысяч символов из cookie-баннера, меню и рекламных врезок.
    // Ловим по формулировкам, которыми издания просят подписаться.
    const wall = [
      /only for registered users/i,
      /looking to read the full article/i,
      /subscribe today/i,
      /this content is (?:only )?available to subscribers/i,
      /sign in to continue reading/i,
      /become a member to read/i,
    ].find((re) => re.test(text));
    if (wall) return { error: 'пайволл' };

    return { text: text.slice(0, 20000) };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'таймаут' : e.message };
  } finally {
    clearTimeout(t);
  }
}

/** Удаляет тексты старше KEEP_DAYS. Возвращает, сколько убрал. */
function prune() {
  if (!fs.existsSync(DIR)) return 0;
  const edge = Date.now() - KEEP_DAYS * 864e5;
  let n = 0;
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.txt')) continue;
    const p = path.join(DIR, f);
    if (fs.statSync(p).mtimeMs < edge) {
      fs.unlinkSync(p);
      n++;
    }
  }
  return n;
}

module.exports = { DIR, KEEP_DAYS, nameFor, extract, fetchArticle, prune };

// Ручная проверка: node article.js <url>
if (require.main === module) {
  fetchArticle(process.argv[2]).then((r) =>
    r.error ? console.log('❌ ' + r.error) : console.log(`✅ ${r.text.length} симв\n\n${r.text.slice(0, 500)}…`)
  );
}
