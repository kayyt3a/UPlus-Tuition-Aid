(() => {
const $ = s => document.querySelector(s), app = $('#app'), hud = $('#hud');
const KEY = 'uplus-v1', SESSION_SIZE = 10;
let DATA, state = load(), session = null;

function load(){ try { return JSON.parse(localStorage.getItem(KEY)) || {profiles:{},current:null}; } catch { return {profiles:{},current:null}; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
const me = () => state.profiles[state.current];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today = () => new Date().toISOString().slice(0,10);
const norm = s => String(s).trim().toLowerCase().replace(/[£$,\s]/g,'').replace(/(cm²|cm2|cm|m²|kg|g|ml|l)$/,'');

fetch('data/questions.json').then(r => r.json()).then(d => { DATA = d; home(); })
  .catch(() => app.innerHTML = '<div class="card">Could not load questions. Serve this folder over http (see README).</div>');

function renderHud(){
  const p = me();
  hud.innerHTML = p ? `${esc(p.name)} · 🔥 ${p.streak||0} · ⭐ ${p.xp||0}` : '';
}

function home(){
  session = null; renderHud();
  if (!me()) return profileScreen();
  const p = me();
  const years = DATA.yearGroups;
  app.innerHTML = `
  <div class="card"><h2>Hi ${esc(p.name)}! 👋</h2>
    <label>Year group</label><select id="yr">${years.map(y=>`<option ${y===p.year?'selected':''}>${y}</option>`).join('')}</select>
    <label>Subject</label><select id="sub"></select>
    <label>Topic</label><select id="top"></select>
    <button id="blitz">⚡ Flashcard blitz (25 Qs)</button>
    <button id="go">Start ${SESSION_SIZE} questions</button>
    <button class="secondary" id="holiday">🏖️ Holiday challenge (mixed, 20 Qs)</button>
  </div>
  <div class="card"><button class="secondary" id="prog">📊 Progress (parents)</button>
  <button class="secondary" id="sw">Switch child</button>
  <button class="secondary" id="code">🔑 Access code${state.code?' ✓':''}</button></div>`;
  const yr=$('#yr'), sub=$('#sub'), top=$('#top');
  const pool = () => DATA.questions.filter(q=>q.year===yr.value);
  function fillSub(){ sub.innerHTML = [...new Set(pool().map(q=>q.subject))].map(s=>`<option>${s}</option>`).join(''); fillTop(); }
  function fillTop(){ const t=[...new Set(pool().filter(q=>q.subject===sub.value).map(q=>q.topic))]; top.innerHTML='<option value="">All topics</option>'+t.map(x=>`<option>${x}</option>`).join(''); }
  yr.onchange = () => { p.year = yr.value; save(); fillSub(); }; sub.onchange = fillTop; fillSub();
  $('#go').onclick = () => start(pool().filter(q=>q.subject===sub.value && (!top.value||q.topic===top.value)), SESSION_SIZE);
  $('#holiday').onclick = () => start(pool(), 20);
  $('#blitz').onclick = () => start(pool().filter(q=>q.subject===sub.value && (!top.value||q.topic===top.value)), 25, true);
  $('#code').onclick = () => { const c = prompt('Enter the access code from U Plus (needed for written-answer marking):', state.code||''); if(c!==null){ state.code=c.trim(); save(); home(); } };
  $('#prog').onclick = progress; $('#sw').onclick = profileScreen;
}

function profileScreen(){
  const names = Object.keys(state.profiles);
  app.innerHTML = `<div class="card"><h2>Who's practising?</h2>
  ${names.map(n=>`<button class="secondary pick" data-n="${esc(n)}">${esc(n)}</button>`).join('')}
  <h3>New child</h3><input type="text" id="nm" placeholder="First name"><button id="add">Add</button></div>`;
  app.querySelectorAll('.pick').forEach(b => b.onclick = () => { state.current=b.dataset.n; save(); home(); });
  $('#add').onclick = () => { const n=$('#nm').value.trim(); if(!n) return;
    state.profiles[n] ||= {name:n,year:DATA.yearGroups[0],xp:0,streak:0,last:null,stats:{},log:[]};
    state.current=n; save(); home(); };
}

// Prioritise questions the child got wrong before / hasn't seen yet.
function pick(pool, n){
  const st = me().stats;
  const w = q => { const s = st[q.id]; if(!s) return 3; return s.wrong/(s.right+s.wrong) > .5 ? 4 : s.right-s.wrong >= 2 ? .5 : 1.5; };
  const items = pool.map(q => ({q, k: Math.random() ** (1/w(q))}));
  return items.sort((a,b)=>b.k-a.k).slice(0,n).map(x=>x.q);
}

function start(pool, n, blitz=false){
  if(!pool.length) return alert('No questions here yet!');
  session = {qs: pick(pool,n), i:0, right:0, blitz, t0: Date.now()};
  question();
}

function question(){
  const s = session, q = s.qs[s.i];
  app.innerHTML = `<div class="card">
    <div class="bar"><div style="width:${s.i/s.qs.length*100}%"></div></div>
    <p class="muted">Question ${s.i+1} of ${s.qs.length} · ${esc(q.subject)} · ${esc(q.topic)}</p>
    <h2>${esc(q.q)}</h2>
    ${q.type==='mc' ? q.options.map((o,i)=>`<button class="opt" data-o="${esc(o)}">${esc(o)}</button>`).join('')
      : q.type==='written' ? `<textarea id="ans" rows="4" placeholder="Write your answer and working"></textarea><button id="sub">Submit for marking</button>`
      : `<input type="text" id="ans" autocomplete="off" placeholder="Your answer"><button id="sub">Check</button>`}
    <div id="fb"></div></div>`;
  if(q.type==='mc') app.querySelectorAll('.opt').forEach(b => b.onclick = () => mark(q, b.dataset.o, b));
  else { const i=$('#ans'); i.focus(); $('#sub').onclick = () => mark(q, i.value); if(q.type!=='written') i.onkeydown = e => e.key==='Enter' && mark(q,i.value); }
}

async function aiMark(q, given){
  const r = await fetch('/api/mark', {method:'POST', headers:{'content-type':'application/json','x-access-code':state.code||''},
    body: JSON.stringify({question:q.q, modelAnswer:q.answer[0], studentAnswer:given, year:q.year, subject:q.subject})});
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error || 'Marking unavailable');
  return j;
}

async function mark(q, given, btn){
  if(session.done) return; session.done = true;
  let ok, aiFb = '';
  if(q.type==='written'){
    if(!String(given).trim()){ session.done=false; return; }
    $('#sub').disabled = true; $('#fb').innerHTML = '<p class="muted">🤖 Marking…</p>';
    try { const r = await aiMark(q, given); ok = !!r.correct; aiFb = r.feedback || ''; }
    catch(e){ session.done=false; $('#sub').disabled=false; $('#fb').innerHTML = `<div class="fb bad">${esc(e.message)}</div>`; return; }
  } else ok = q.answer.some(a => norm(a) === norm(given));
  const p = me(), st = p.stats[q.id] ||= {right:0,wrong:0};
  ok ? (st.right++, session.right++, p.xp += 10) : st.wrong++;
  if(q.type==='mc') app.querySelectorAll('.opt').forEach(b => { b.disabled = true;
    if(q.answer.includes(b.dataset.o)) b.classList.add('right'); else if(b===btn) b.classList.add('wrong'); });
  else { $('#ans').disabled = true; $('#sub').remove(); }
  $('#fb').innerHTML = `<div class="fb ${ok?'good':'bad'}">${ok?'✅ Correct! +10 XP':'❌ Not quite. Answer: <b>'+esc(q.answer[0])+'</b>'}<br>${esc(aiFb||q.explain||'')}</div>
    <button id="next">${session.i+1<session.qs.length?'Next':'Finish'}</button>`;
  save();
  const next = () => { session.done=false; session.i++; session.i<session.qs.length ? question() : finish(); };
  $('#next').onclick = next;
  if(session.blitz && ok) setTimeout(() => { if(session.done && document.body.contains($('#next'))) next(); }, 700); // blitz: auto-advance on correct
}

function finish(){
  const p = me(), s = session, t = today();
  if(p.last !== t){ const y = new Date(Date.now()-864e5).toISOString().slice(0,10); p.streak = p.last===y ? (p.streak||0)+1 : 1; p.last = t; }
  p.xp += 20; // session bonus
  p.log.push({d:t, n:s.qs.length, right:s.right, year:s.qs[0].year}); save(); renderHud();
  app.innerHTML = `<div class="card"><h2>Done! 🎉</h2><p>${s.blitz?`⚡ ${Math.round((Date.now()-s.t0)/1000)}s · `:''}${s.right} / ${s.qs.length} correct · +20 bonus XP</p>
  <p>🔥 ${p.streak}-day streak</p><button id="again">Practise more</button></div>`;
  $('#again').onclick = home;
}

function progress(){
  const p = me(), rows = {};
  DATA.questions.forEach(q => { const s = p.stats[q.id]; if(!s) return;
    const k = `${q.year}|${q.subject}|${q.topic}`; (rows[k] ||= {r:0,w:0}); rows[k].r+=s.right; rows[k].w+=s.wrong; });
  const days = new Set(p.log.map(l=>l.d)).size;
  app.innerHTML = `<div class="card"><h2>${esc(p.name)}'s progress</h2>
  <p>${p.log.reduce((a,l)=>a+l.n,0)} questions over ${days} day(s) · 🔥 ${p.streak||0} streak · ⭐ ${p.xp} XP</p>
  <table><tr><th>Topic</th><th>Accuracy</th><th>Done</th></tr>
  ${Object.entries(rows).map(([k,v])=>{const [y,s,t]=k.split('|'),n=v.r+v.w,a=Math.round(v.r/n*100);
    return `<tr><td>${esc(y)} ${esc(s)}: ${esc(t)}</td><td>${a}% ${a<60?'⚠️':''}</td><td>${n}</td></tr>`}).join('') || '<tr><td colspan=3>No practice yet.</td></tr>'}
  </table><p class="muted">⚠️ = needs more practice (the app serves these more often).</p>
  <button id="back">Back</button></div>`;
  $('#back').onclick = home;
}
})();
