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
const os = require('os');
const util = require('util');
const { execFile } = require('child_process');
const execFileP = util.promisify(execFile);

const DIR = __dirname;
const QUEUE = path.join(DIR, 'queue.json');
const PORT = 4321;

// Накладывает дизайн (compose.js) и публикует картинку (add-image.sh),
// возвращает публичный raw-URL.
async function composeAndPublish(id, imageB64, ext, caption) {
  const safeExt = /^(jpg|jpeg|png|webp)$/i.test(ext) ? ext.toLowerCase() : 'jpg';
  const tmpBase = path.join(os.tmpdir(), `avare-in-${id}-${Date.now()}.${safeExt}`);
  const tmpOut = path.join(os.tmpdir(), `avare-out-${id}-${Date.now()}.jpg`);
  fs.writeFileSync(tmpBase, Buffer.from(imageB64, 'base64'));

  await execFileP(process.execPath, [
    path.join(DIR, 'compose.js'),
    '--base', tmpBase,
    '--headline', caption || '',
    '--out', tmpOut,
  ]);

  const { stdout } = await execFileP('bash', [
    path.join(DIR, 'add-image.sh'), tmpOut, `post${id}`,
  ]);
  const url = stdout.trim().split('\n').filter(Boolean).pop();

  try { fs.unlinkSync(tmpBase); fs.unlinkSync(tmpOut); } catch {}
  if (!/^https:\/\//.test(url)) throw new Error('add-image.sh не вернул ссылку: ' + url);
  return url;
}

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
  .imgbox{margin-top:12px;padding:12px;border:1px dashed var(--line);border-radius:8px}
  .imgbox .lbl{font-size:12px;color:var(--dim);margin-bottom:7px}
  .imgbox input[type=text]{width:100%;padding:8px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-size:13px;margin-bottom:8px}
  .imgbox .file{font-size:13px;margin-bottom:8px}
  .thumb{margin-top:10px;max-width:100%;border-radius:6px;border:1px solid var(--line)}
  .imgstate{font-size:12px;margin-top:8px}
  .imgstate.busy{color:var(--accent)}.imgstate.done{color:#2f8f4e}.imgstate.err{color:#c0392b}
  .curimg{margin-top:8px}.curimg img{max-width:100%;border-radius:6px;border:1px solid var(--line)}
</style></head><body>
<header>
  <h1>Отбор новостей · Avare BioTech</h1>
  <div class="counts" id="counts"></div>
  <div class="tabs" id="tabs"></div>
</header>
<main id="list"></main>
<script>
const STATUSES=[['draft','Черновики'],['ready','С текстом'],['approved','Одобрено'],['posted','Опубликовано'],['rejected','Отклонено']];
let data={items:[]}, inbox=[], filter='inbox';

async function api(path,body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json();
  if(j.items) data=j;
  if(j.inbox) inbox=j.inbox;
  await refreshInbox(); render();
}
async function refreshInbox(){ try{ inbox=await (await fetch('/api/inbox')).json(); }catch(e){} }
async function loadData(){ data=await (await fetch('/api/queue')).json(); await refreshInbox(); render(); }

function words(t){ return t.trim()?t.trim().split(/\\s+/).length:0 }

function render(){
  const counts={};
  data.items.forEach(i=>counts[i.status]=(counts[i.status]||0)+1);
  document.getElementById('counts').textContent =
    STATUSES.filter(([s])=>counts[s]).map(([s,n])=>n+': '+counts[s]).join(' · ') || 'пусто';

  const allTabs=[['inbox','Входящие '+inbox.length]].concat(STATUSES.map(([s,n])=>[s,n+' '+(counts[s]||0)]));
  document.getElementById('tabs').innerHTML = allTabs
    .map(([s,label])=>'<button class="tab'+(filter===s?' on':'')+'" data-s="'+s+'">'+label+'</button>').join('');
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{filter=b.dataset.s;render()});

  const el=document.getElementById('list');

  if(filter==='inbox'){ renderInbox(el); return }

  const items=data.items.filter(i=>i.status===filter);
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
      +   '<div class="imgbox">'
      +     '<div class="lbl">Картинка с фирменным дизайном</div>'
      +     (i.image_url&&/^https/.test(i.image_url)?'<div class="curimg"><img src="'+esc(i.image_url)+'"><div class="lbl">текущая — уже с дизайном</div></div>':'')
      +     '<input type="text" class="cap" placeholder="Подпись на картинке (внизу слева)" value="'+esc(i.image_caption||i.headline||'')+'">'
      +     '<div class="file"><input type="file" class="pick" accept="image/*"></div>'
      +     '<button class="act pri" data-a="compose">Наложить дизайн и прикрепить</button>'
      +     '<div class="imgstate"></div>'
      +   '</div>'
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
    const cap=card.querySelector('.cap');
    const pick=card.querySelector('.pick');
    const imgstate=card.querySelector('.imgstate');
    card.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{
      const a=b.dataset.a;
      if(a==='write'||a==='edit'){ ed.classList.toggle('hide'); return }
      if(a==='compose'){
        const f=pick&&pick.files&&pick.files[0];
        if(!f){ imgstate.className='imgstate err'; imgstate.textContent='Сначала выбери файл картинки'; return }
        const cn=cap?cap.value.trim():'';
        imgstate.className='imgstate busy'; imgstate.textContent='Накладываю дизайн и публикую… (несколько секунд)';
        const rd=new FileReader();
        rd.onload=async ()=>{
          const b64=String(rd.result).split(',')[1];
          const ext=(f.name.split('.').pop()||'jpg').toLowerCase();
          try{
            const r=await fetch('/api/compose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,imageB64:b64,ext,caption:cn})});
            const j=await r.json();
            if(j.ok){ imgstate.className='imgstate done'; imgstate.textContent='Готово, картинка прикреплена'; data=j.queue||data; render(); }
            else{ imgstate.className='imgstate err'; imgstate.textContent='Ошибка: '+(j.error||'не удалось'); }
          }catch(e){ imgstate.className='imgstate err'; imgstate.textContent='Ошибка сети: '+e.message; }
        };
        rd.readAsDataURL(f);
        return;
      }
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
function renderInbox(el){
  if(!inbox.length){ el.innerHTML='<div class="empty">Новых неразобранных новостей нет. Бот собирает их каждый день.</div>'; return }
  el.innerHTML='<div class="empty" style="padding:10px 0;text-align:left">Собрано ботом, ещё не отобрано — '+inbox.length+' шт. Возьми в работу то, что подходит темам Avare.</div>'
    + inbox.map((x,idx)=>'<div class="card" data-idx="'+idx+'">'
      + '<div class="meta">'+esc(x.source||'')+(x.author?' · '+esc(x.author):'')+' · '+(x.date||x.collected||'')+'</div>'
      + '<p class="hl">'+esc(x.headline||'')+'</p>'
      + (x.summary?'<div class="sum">'+esc(x.summary.slice(0,220))+'</div>':'')
      + '<div><a href="'+esc(x.url)+'" target="_blank" rel="noopener">Открыть источник ↗</a></div>'
      + '<div class="row">'
      +   '<button class="act pri" data-ia="add">Взять в работу</button>'
      +   '<button class="act" data-ia="hide">Скрыть</button>'
      + '</div></div>').join('');
  el.querySelectorAll('.card').forEach(card=>{
    const x=inbox[+card.dataset.idx];
    card.querySelectorAll('[data-ia]').forEach(b=>b.onclick=()=>{
      if(b.dataset.ia==='add')  return api('/api/inbox-add',{url:x.url});
      if(b.dataset.ia==='hide') return api('/api/inbox-hide',{url:x.url});
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

    if (req.url === '/api/inbox') {
      const q = load();
      const inboxFile = path.join(DIR, 'inbox.json');
      const ib = fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : { items: [] };
      const seen = new Set([...q.items, ...(q.log || [])].map((i) => i.url));
      const dismissed = new Set(q.dismissed || []);
      // Только свежее: собранное за последние 5 дней. Старое неактуально.
      const cutoff = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
      const fresh = ib.items
        .filter((x) => x.url && !seen.has(x.url) && !dismissed.has(x.url))
        .filter((x) => (x.collected || x.date || '') >= cutoff)
        .sort((a, b) => (b.date || b.collected || '').localeCompare(a.date || a.collected || ''));
      return json(fresh);
    }

    if (req.method === 'POST') {
      const q = load();
      const d = await body(req);

      // Входящие адресуются по url, а не по id — обрабатываем до поиска item.
      if (req.url === '/api/inbox-hide') {
        q.dismissed = q.dismissed || [];
        if (d.url && !q.dismissed.includes(d.url)) q.dismissed.push(d.url);
        save(q);
        return json(q);
      }
      if (req.url === '/api/inbox-add') {
        const inboxFile = path.join(DIR, 'inbox.json');
        const ib = fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : { items: [] };
        const src = ib.items.find((x) => x.url === d.url);
        if (!src) return json(q);
        if (q.items.some((i) => i.url === d.url) || (q.log || []).some((l) => l.url === d.url)) return json(q);
        if (!q.nextId) q.nextId = Math.max(0, ...q.items.map((i) => i.id)) + 1;
        q.items.push({
          id: q.nextId++,
          status: 'draft',
          headline: src.headline,
          url: src.url,
          source: src.source || '',
          author: src.author || '',
          category: src.category || '',
          summary: src.summary || '',
          date: src.date || src.collected || '',
          post_text: '',
          image_url: '',
          added: new Date().toISOString(),
        });
        save(q);
        return json(q);
      }

      const item = q.items.find((i) => i.id === d.id);
      if (!item) return json(q);

      if (req.url === '/api/compose') {
        try {
          const url = await composeAndPublish(d.id, d.imageB64, d.ext, d.caption);
          // перечитываем очередь: add-image.sh делал git commit, но queue.json он не трогает
          const q2 = load();
          const it2 = q2.items.find((i) => i.id === d.id);
          it2.image_url = url;
          it2.image_caption = d.caption || '';
          save(q2);
          return json({ ok: true, url, queue: q2 });
        } catch (e) {
          return json({ ok: false, error: e.message });
        }
      }

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
