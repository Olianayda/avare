#!/usr/bin/env node
/**
 * Локальная панель для отбора новостей.
 *
 *   node server.js          → http://localhost:4321
 *
 * Читает и пишет queue.json. Никуда ничего не отправляет:
 * публикация остаётся отдельным осознанным шагом.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIR = __dirname;
const QUEUE = path.join(DIR, 'queue.json');
const PORT = 4321;

const load = () =>
  fs.existsSync(QUEUE) ? JSON.parse(fs.readFileSync(QUEUE, 'utf8')) : { items: [], log: [], nextId: 1 };
const save = (q) => fs.writeFileSync(QUEUE, JSON.stringify(q, null, 2) + '\n');

const PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avare · отбор новостей</title>
<style>
  :root{--bg:#fbfaf8;--card:#fff;--ink:#1a1a1a;--dim:#6b6b6b;--line:#e6e3dd;--accent:#7b1e3a}
  @media(prefers-color-scheme:dark){:root{--bg:#16151a;--card:#1f1e24;--ink:#eceaf0;--dim:#9a97a3;--line:#302e38;--accent:#e0819c}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  header{padding:22px 24px 14px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
  h1{margin:0;font-size:19px;letter-spacing:-.01em}
  .counts{color:var(--dim);font-size:13px;margin-top:5px}
  .tabs{display:flex;gap:6px;margin-top:14px;flex-wrap:wrap}
  .tab{padding:5px 12px;border:1px solid var(--line);border-radius:99px;background:none;color:var(--dim);cursor:pointer;font-size:13px}
  .tab.on{background:var(--accent);border-color:var(--accent);color:#fff}
  main{padding:18px 24px 60px;max-width:840px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px}
  .meta{font-size:12px;color:var(--dim);margin-bottom:6px}
  .badge{display:inline-block;padding:1px 8px;border-radius:99px;border:1px solid var(--line);margin-right:6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .hl{font-weight:600;font-size:16px;margin:0 0 6px;line-height:1.35}
  .sum{color:var(--dim);font-size:13.5px;margin:6px 0 10px}
  a{color:var(--accent)}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  button.act{padding:6px 13px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;font-size:13px}
  button.act:hover{border-color:var(--accent)}
  button.pri{background:var(--accent);border-color:var(--accent);color:#fff}
  textarea{width:100%;min-height:190px;padding:11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,monospace;resize:vertical}
  input[type=url]{width:100%;padding:8px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-size:13px;margin-top:8px}
  .wc{font-size:12px;color:var(--dim);margin-top:6px}
  .wc.bad{color:#c0392b}
  .empty{color:var(--dim);padding:40px 0;text-align:center}
  .hide{display:none}
</style></head><body>
<header>
  <h1>Отбор новостей · Avare BioTech</h1>
  <div class="counts" id="counts"></div>
  <div class="tabs" id="tabs"></div>
</header>
<main id="list"></main>
<script>
const STATUSES=[['draft','Черновики'],['ready','С текстом'],['approved','Одобрено'],['posted','Опубликовано'],['rejected','Отклонено']];
let data={items:[]}, filter='draft';

async function api(path,body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  data=await r.json(); render();
}
async function loadData(){ data=await (await fetch('/api/queue')).json(); render(); }

function words(t){ return t.trim()?t.trim().split(/\\s+/).length:0 }

function render(){
  const counts={};
  data.items.forEach(i=>counts[i.status]=(counts[i.status]||0)+1);
  document.getElementById('counts').textContent =
    STATUSES.filter(([s])=>counts[s]).map(([s,n])=>n+': '+counts[s]).join(' · ') || 'пусто';

  document.getElementById('tabs').innerHTML = STATUSES
    .map(([s,n])=>'<button class="tab'+(filter===s?' on':'')+'" data-s="'+s+'">'+n+' '+(counts[s]||0)+'</button>').join('');
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{filter=b.dataset.s;render()});

  const items=data.items.filter(i=>i.status===filter);
  const el=document.getElementById('list');
  if(!items.length){ el.innerHTML='<div class="empty">Здесь пусто.</div>'; return }

  el.innerHTML=items.map(i=>{
    const wc=words(i.post_text||'');
    const bad=i.post_text && (wc<120||wc>180);
    return '<div class="card" data-id="'+i.id+'">'
      + '<div class="meta"><span class="badge">'+(i.category||'—')+'</span>'
      + i.source + (i.author?' · '+i.author:'') + ' · ' + (i.date||'')
      + (i.republish_count?' · <b>переопубликация №'+i.republish_count+'</b>':'') + '</div>'
      + '<p class="hl">'+esc(i.headline)+'</p>'
      + (i.summary?'<div class="sum">'+esc(i.summary.slice(0,240))+'</div>':'')
      + '<div><a href="'+i.url+'" target="_blank" rel="noopener">Открыть источник ↗</a></div>'
      + '<div class="row">'
      +   (i.status==='draft'?'<button class="act pri" data-a="write">Написать вручную</button><button class="act" data-a="reject">Отклонить</button>':'')
      +   (i.status==='ready'?'<button class="act pri" data-a="approve">Одобрить</button><button class="act" data-a="edit">Править</button><button class="act" data-a="reject">Отклонить</button>':'')
      +   (i.status==='approved'?'<button class="act" data-a="edit">Править</button><button class="act" data-a="unapprove">Вернуть в правку</button>':'')
      +   (i.status==='posted'?'<button class="act pri" data-a="republish">Переопубликовать с правками</button><button class="act" data-a="edit">Посмотреть текст</button>':'')
      +   (i.status==='rejected'?'<button class="act" data-a="restore">Вернуть в черновики</button>':'')
      + '</div>'
      + '<div class="editor hide">'
      +   '<textarea>'+esc(i.post_text||'')+'</textarea>'
      +   '<div class="wc'+(bad?' bad':'')+'">слов: '+wc+' · норма 120–180</div>'
      +   '<input type="url" placeholder="URL картинки (https://…)" value="'+(i.image_url||'')+'">'
      +   '<div class="row"><button class="act pri" data-a="save">Сохранить</button></div>'
      + '</div>'
      + '</div>';
  }).join('');

  el.querySelectorAll('.card').forEach(card=>{
    const id=+card.dataset.id;
    const ed=card.querySelector('.editor');
    const ta=card.querySelector('textarea');
    const im=card.querySelector('input[type=url]');
    const wcEl=card.querySelector('.wc');
    if(ta) ta.oninput=()=>{const w=words(ta.value);wcEl.textContent='слов: '+w+' · норма 120–180';wcEl.classList.toggle('bad',w<120||w>180)};
    card.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{
      const a=b.dataset.a;
      if(a==='write'||a==='edit'){ ed.classList.toggle('hide'); return }
      if(a==='save')      return api('/api/save',{id,post_text:ta.value,image_url:im.value});
      if(a==='approve')   return api('/api/status',{id,status:'approved'});
      if(a==='unapprove') return api('/api/status',{id,status:'ready'});
      if(a==='reject')    return api('/api/status',{id,status:'rejected'});
      if(a==='restore')   return api('/api/status',{id,status:'draft'});
      if(a==='republish'){
        if(!confirm('Вернуть пост в правку для повторной публикации?\\n\\nУдалить старую версию из LinkedIn нужно вручную — отсюда это невозможно.')) return;
        return api('/api/status',{id,status:'ready',republish:true});
      }
    });
  });
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
loadData();
</script></body></html>`;

function body(req) {
  return new Promise((res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => res(b ? JSON.parse(b) : {}));
  });
}

http
  .createServer(async (req, res) => {
    const json = (o) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(o));
    };

    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (req.url === '/api/queue') return json(load());

    if (req.method === 'POST') {
      const q = load();
      const d = await body(req);
      const item = q.items.find((i) => i.id === d.id);
      if (!item) return json(q);

      if (req.url === '/api/save') {
        item.post_text = d.post_text || '';
        item.image_url = d.image_url || '';
        if (item.post_text && item.status === 'draft') item.status = 'ready';
      }
      if (req.url === '/api/status') {
        item.status = d.status;
        if (d.republish) {
          // Счётчик повторов и пометка, что предыдущая версия уже была в ленте.
          item.republish_of = item.posted_date || item.republish_of || '';
          item.republish_count = (item.republish_count || 0) + 1;
          delete item.posted_date;
        }
      }

      save(q);
      return json(q);
    }

    res.writeHead(404);
    res.end('not found');
  })
  .listen(PORT, () => console.log(`Панель: http://localhost:${PORT}`));
