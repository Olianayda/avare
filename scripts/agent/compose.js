#!/usr/bin/env node
/**
 * Накладывает фирменный дизайн Avare на картинку:
 * тёмный градиент снизу, логотип справа внизу, заголовок мелким слева.
 *
 *   node compose.js --base фото.jpg --headline "Текст внизу слева" --out out.jpg
 *
 * Рендер через headless Chrome по HTML — так точно контролируются градиент,
 * шрифт и раскладка. Логотип берётся из assets/avare-logo.webp (белый на прозрачном).
 *
 * Шрифт: Satoshi, если установлен; иначе близкий системный гротеск.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = __dirname;
const LOGO = path.join(DIR, 'assets', 'avare-logo.webp');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}
function die(m) { console.error(`❌ ${m}`); process.exit(1); }

const base = arg('base');
const headline = arg('headline', '');
const out = arg('out');
if (!base || !fs.existsSync(base)) die('Нужен существующий --base <файл>');
if (!out) die('Нужен --out <файл>');
if (!fs.existsSync(LOGO)) die(`Нет логотипа: ${LOGO}`);

// Размеры базовой картинки через sips.
const probe = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', base]).toString();
const W = +(probe.match(/pixelWidth:\s*(\d+)/) || [])[1] || 1200;
const H = +(probe.match(/pixelHeight:\s*(\d+)/) || [])[1] || 800;

const b64 = (p) => fs.readFileSync(p).toString('base64');
const baseMime = base.toLowerCase().endsWith('.png') ? 'png' : base.toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg';

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Заголовок мелкий: масштабируем от ширины картинки.
const fs_headline = Math.round(W * 0.026);
const logoW = Math.round(W * 0.17);
const pad = Math.round(W * 0.035);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'SatoshiLocal';src:local('Satoshi-Bold'),local('Satoshi');}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  .wrap{position:relative;width:${W}px;height:${H}px}
  .photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .grad{position:absolute;left:0;right:0;bottom:0;height:55%;
    background:linear-gradient(to top,
      rgba(0,0,0,.88) 0%, rgba(0,0,0,.72) 18%, rgba(0,0,0,.35) 40%, rgba(0,0,0,0) 100%)}
  .headline{position:absolute;left:${pad}px;bottom:${pad}px;max-width:${Math.round(W * 0.62)}px;
    color:#fff;font-family:'SatoshiLocal','Helvetica Neue','Avenir Next',system-ui,sans-serif;
    font-style:normal;font-weight:600;font-size:${fs_headline}px;line-height:1.3;letter-spacing:.005em;
    text-shadow:0 1px 12px rgba(0,0,0,.5)}
  .logo{position:absolute;right:${pad}px;bottom:${Math.round(pad * 1.05)}px;
    width:${logoW}px;opacity:.96;filter:drop-shadow(0 1px 8px rgba(0,0,0,.45))}
</style></head><body>
  <div class="wrap">
    <img class="photo" src="data:image/${baseMime};base64,${b64(base)}">
    <div class="grad"></div>
    ${headline ? `<div class="headline">${esc(headline)}</div>` : ''}
    <img class="logo" src="data:image/webp;base64,${b64(LOGO)}">
  </div>
</body></html>`;

const tmpHtml = path.join(require('os').tmpdir(), `avare-compose-${Date.now()}.html`);
const tmpPng = path.join(require('os').tmpdir(), `avare-compose-${Date.now()}.png`);
fs.writeFileSync(tmpHtml, html);

// Рендер в 2x для чёткости.
execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--hide-scrollbars',
  `--force-device-scale-factor=2`,
  `--window-size=${W},${H}`,
  `--screenshot=${tmpPng}`,
  `file://${tmpHtml}`,
], { stdio: 'ignore' });

if (!fs.existsSync(tmpPng)) die('Chrome не отрендерил картинку');

// PNG → итоговый формат, ужимаем ширину до исходной (2x был для чёткости текста).
const outExt = out.toLowerCase().endsWith('.png') ? 'png' : out.toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg';
execFileSync('sips', ['-s', 'format', outExt, '--resampleWidth', String(W), tmpPng, '--out', out], { stdio: 'ignore' });

fs.unlinkSync(tmpHtml);
fs.unlinkSync(tmpPng);

const size = fs.statSync(out).size;
console.log(`✅ Готово: ${out} (${W}x${H}, ${size} байт)`);
