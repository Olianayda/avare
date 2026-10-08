#!/usr/bin/env node
/**
 * Проверка поста по механическим правилам скилла skills/avare-news-posts.md.
 *
 *   node post-rules.js           все неопубликованные посты с текстом
 *   node post-rules.js 36 37     только эти номера
 *
 * Код выхода 1, если есть хоть одна ошибка. Облачной рутине велено
 * прогнать проверку перед коммитом, панель показывает результат на карточке,
 * queue.js не даёт записать текст с ошибками.
 *
 * Зачем это в коде, а не только в самопроверке модели: модель честно пишет
 * «проверил подсчётом», а считать слова и замечать длинное тире она не умеет
 * надёжно. Здесь только то, что проверяется без понимания смысла.
 * «Понятно человеку вне отрасли» и «наш голос только в конце» остаются
 * на модели и на человеке в панели.
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;

const WORDS_MIN = 120;
const WORDS_MAX = 180;
const FIRST_LINE_MAX = 140;
const TAGS_MIN = 3;
const TAGS_MAX = 5;
const LINKEDIN_MAX = 3000;
const BUZZ = /\b(disruptive|game[- ]changer|paradigm shift|synerg\w*|as we all know|it is well established)\b/gi;

// Слова считаем без хештегов: облачная рутина считала вместе с ними и
// упиралась ровно в 180, а без них все прошлые посты укладываются в норму.
const wordList = (t) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w) && !w.startsWith('#'));
const hashtags = (t) => t.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) || [];

/**
 * → [{ level: 'error' | 'warn', text }]
 * article: запись о статье во входящих (inbox.json) или undefined.
 */
function checkPost(item, article) {
  const out = [];
  const err = (text) => out.push({ level: 'error', text });
  const warn = (text) => out.push({ level: 'warn', text });

  // Издание не отдало статью — у агента был только анонс из RSS на пару строк.
  if (article && !article.body_file) {
    warn('Статья не скачалась (издание закрыло доступ). Если текст писал агент, у него был только короткий анонс из RSS: сверьте факты с оригиналом.');
  }

  const t = item.post_text || '';
  if (!t.trim()) return out;

  const n = wordList(t).length;
  if (n < WORDS_MIN || n > WORDS_MAX) err(`Слов: ${n}, нужно ${WORDS_MIN}–${WORDS_MAX} (хештеги не считаются).`);

  if (/maksa/i.test(t)) err('Упомянута MAKSA. В новостных постах продукт не называется.');

  const dashes = (t.match(/[—―]/g) || []).length;
  if (dashes) err(`Длинное тире (—): ${dashes} шт. Заменить на точку, запятую или короткое тире.`);

  if (/semen/i.test(t)) err('«semen» написано латинской «е». Нужна кириллическая: sеmen, #sеmen.');

  const lines = t.split('\n');
  const first = lines[0].trim();
  if (first.length > FIRST_LINE_MAX) err(`Первая строка длиннее ${FIRST_LINE_MAX} знаков (${first.length}): в ленте до «…ещё» видно примерно столько.`);
  if (lines.length > 1 && lines[1].trim() !== '') err('После первой строки нужна пустая строка: вывод стоит отдельно.');

  const tags = hashtags(t).length;
  if (tags < TAGS_MIN || tags > TAGS_MAX) err(`Хештегов: ${tags}, нужно ${TAGS_MIN}–${TAGS_MAX}.`);

  if (t.length > LINKEDIN_MAX) err(`Длина ${t.length} зн.: LinkedIn обрежет пост длиннее ${LINKEDIN_MAX}.`);

  if (/avare/i.test(t)) warn('Упомянута Avare. Похоже на подводку к продукту, а правила это запрещают.');

  const buzz = [...new Set((t.match(BUZZ) || []).map((w) => w.toLowerCase()))];
  if (buzz.length) warn(`Штампы: ${buzz.join(', ')}.`);

  // Атрибуция: в тексте должно встретиться издание или фамилия автора.
  const low = t.toLowerCase();
  const source = (item.source || '').toLowerCase().replace(/^the\s+/, '');
  const surname = (item.author || '').trim().split(/\s+/).pop().toLowerCase();
  if ((source || surname) && !(source && low.includes(source)) && !(surname && low.includes(surname))) {
    warn(`Не видно атрибуции: в тексте нет ни издания (${item.source || '—'}), ни автора (${item.author || '—'}).`);
  }

  return out;
}

/** Входящие по ссылке на статью: для пометки «статья не скачалась». */
function loadArticles() {
  try {
    const ib = JSON.parse(fs.readFileSync(path.join(DIR, 'inbox.json'), 'utf8'));
    return new Map(ib.items.map((i) => [i.url, i]));
  } catch {
    return new Map();
  }
}

module.exports = { checkPost, loadArticles };

if (require.main === module) {
  const q = JSON.parse(fs.readFileSync(path.join(DIR, 'queue.json'), 'utf8'));
  const ids = process.argv.slice(2);
  const items = ids.length
    ? ids.map((id) => q.items.find((i) => String(i.id) === id) || console.error(`Нет поста №${id}`)).filter(Boolean)
    : q.items.filter((i) => ['draft', 'ready', 'approved'].includes(i.status) && i.post_text);
  const articles = loadArticles();

  let errors = 0;
  for (const i of items) {
    const res = checkPost(i, articles.get(i.url));
    errors += res.filter((r) => r.level === 'error').length;
    if (!res.length) continue;
    console.log(`№${i.id} ${i.status} · ${(i.post_text || i.headline).split('\n')[0].slice(0, 70)}`);
    for (const r of res) console.log(`  ${r.level === 'error' ? '✗' : '!'} ${r.text}`);
  }
  console.log(errors ? `\nОшибок: ${errors}. Исправить до коммита.` : `Проверено постов: ${items.length}, ошибок нет.`);
  process.exitCode = errors ? 1 : 0;
}
