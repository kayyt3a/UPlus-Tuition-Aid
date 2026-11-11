(() => {
const $ = s => document.querySelector(s), app = $('#app'), nav = $('#nav');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let ME = null, child = null, S = null, subj = null;
const DAILY_GOAL = 10;
const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const fmt = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

// ---------- icons (one consistent line set) ----------
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.2c2.6.2 4.5 2.1 4.5 5.3"/>',
  out: '<path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2 2 0 012.9 0l.1.1a2 2 0 010 2.9L8 19l-4 1z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  import: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'
};
const ico = n => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.body ? (opts.method || 'POST') : (opts.method || 'GET'), headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong'); e.status = r.status; throw e; }
  return j;
}
async function boot() {
  try { ME = await api('/me'); } catch { ME = null; }
  if (!ME) return authScreen();
  const saved = +LS.get('child'); child = ME.children.find(c => c.id === saved) || ME.children[0] || null;
  ME.user.role === 'admin' ? admin() : child ? home() : addChild(true);
}
function setNav(active) {
  nav.style.display = '';
  if (!ME) { nav.innerHTML = ''; return; }
  const items = ME.user.role === 'admin' ? [['admin', 'users', 'Families'], ['import', 'import', 'Import']] : [['home', 'home', 'Practice'], ['mine', 'chart', 'Progress'], ['parent', 'users', 'Parents']];
  nav.innerHTML = items.map(([k, i, l]) => `<button data-nav="${k}" class="${k === active ? 'on' : ''}">${ico(i)}${l}</button>`).join('') + `<button data-nav="out">${ico('out')}Log out</button>`;
}
nav.onclick = e => { const k = e.target.closest('[data-nav]')?.dataset.nav; if (!k) return; if (S) clearInterval(S.tick); S = null;
  ({ home, mine, parent: parentView, admin, import: importScreen, out: async () => { await api('/logout', { body: {} }); ME = null; authScreen(); } })[k](); };

// ---------- shared bits ----------
const valuesHtml = () => `<div class="values"><span>Uplift</span><span>Persevere</span><span>Lead</span><span>Understand</span><span>Support</span></div><div class="values zh"><span>鼓舞</span><span>坚持</span><span>引导</span><span>理解</span><span>支持</span></div>`;
const accColor = a => a >= 75 ? 'var(--good)' : a >= 55 ? 'var(--mid)' : 'var(--bad)';
const tag = a => `<span class="tag ${a >= 75 ? 'good' : a >= 55 ? 'warn' : 'bad'}">${a}%</span>`;
const strip = items => `<div class="strip">${items.map(([v, l]) => `<div class="m"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const today = () => new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

// ---------- auth ----------
function authScreen(mode = 'login', err = '') {
  setNav();
  app.innerHTML = `<div class="auth">
  <p class="eyebrow">Student practice portal</p><h1>${mode === 'signup' ? 'Create a family account' : 'Sign in'}</h1><div class="rule"></div>
  <div class="tabs"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">Sign in</button><button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">New family</button></div>
  <form id="f">${mode === 'signup' ? `<label>Parent name</label><input type="text" name="name" required>` : ''}
  <label>Email</label><input type="email" name="email" required autocomplete="username">
  <label>Password${mode === 'signup' ? ' (8+ characters)' : ''}</label><input type="password" name="password" required autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">
  ${mode === 'signup' ? `<label>Family code (provided by UPlus)</label><input type="text" name="code" required>` : ''}
  <div class="err">${esc(err)}</div><button class="btn block" style="margin-top:8px">${mode === 'signup' ? 'Create account' : 'Sign in'}</button></form>
  ${mode === 'login' ? `<p class="muted" style="margin-top:14px">Demo account: parent@uplus.test / parent123</p>` : ''}
  <div class="brandfoot">${valuesHtml()}</div></div>`;
  app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => authScreen(b.dataset.m));
  $('#f').onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
    try { await api(mode === 'signup' ? '/signup' : '/login', { body }); boot(); } catch (x) { authScreen(mode, x.message); } };
}
function addChild(first) {
  setNav('home');
  app.innerHTML = `<div class="auth"><p class="eyebrow">${first ? 'Get started' : 'Family'}</p><h1>${first ? 'Add your first child' : 'Add a child'}</h1><div class="rule"></div>
  <form id="f"><label>First name</label><input type="text" name="name" required maxlength="40">
  <label>Year group</label><select name="year">${ME.years.map(y => `<option>${y}</option>`).join('')}</select>
  <div class="err" id="e"></div><button class="btn block" style="margin-top:8px">Add child</button>${first ? '' : '<button type="button" class="btn secondary block" id="cancel" style="margin-top:8px">Cancel</button>'}</form></div>`;
  if (!first) $('#cancel').onclick = home;
  $('#f').onsubmit = async e => { e.preventDefault(); try { const r = await api('/children', { body: Object.fromEntries(new FormData(e.target)) }); LS.set('child', r.id); await boot(); } catch (x) { $('#e').textContent = x.message; } };
}

// ---------- practice home ----------
function home() {
  setNav('home'); if (!ME.user.paid) return locked();
  const cat = ME.catalog[child.year] || {}, subs = Object.keys(cat); if (!subs.includes(subj)) subj = subs[0];
  app.innerHTML = `<div class="head"><p class="eyebrow">${today()}</p><h1>${greet()}, ${esc(child.name)}</h1>
    <div class="goal"><div class="pbar"><i id="gbar" style="width:0"></i></div><span id="gtxt">&nbsp;</span></div></div>
  <div class="toolbar"><div><label>Student</label><div class="sc">${ME.children.map(c => `<button data-kid="${c.id}" class="${c.id === child.id ? 'on' : ''}">${esc(c.name)}</button>`).join('')}<button id="addkid">+ Add</button></div></div>
    <div class="yr"><label>Year group</label><select id="yr">${ME.years.map(y => `<option ${y === child.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
  ${subs.length ? `<div class="panel"><label style="margin-top:0">Subject</label><div class="sc" id="subs">${subs.map(s => `<button data-s="${esc(s)}" class="${s === subj ? 'on' : ''}">${esc(s)}</button>`).join('')}</div>
    <label>Topic</label><select id="top"></select>
    <button class="btn cta block" id="go" style="margin-top:18px"><span>Start practice <small>&nbsp;10 questions</small></span>${ico('arrow')}</button></div>
  <label style="margin-top:26px">Other ways to practise</label>
  <div class="list">
    <button class="lrow" id="blitz">${ico('bolt')}<span><b>Flashcard blitz</b><small>25 quick questions, one after another</small></span>${ico('arrow')}</button>
    <button class="lrow" id="mock">${ico('clock')}<span><b>Timed mock test</b><small>15 questions against the clock; saved for your parents to see</small></span>${ico('arrow')}</button>
    <button class="lrow" id="holiday">${ico('sun')}<span><b>Holiday challenge</b><small>20 mixed questions from across the year</small></span>${ico('arrow')}</button></div>`
    : `<div class="panel"><p class="muted" style="margin:0">There are no questions for ${esc(child.year)} yet.</p></div>`}
  <div class="brandfoot">${valuesHtml()}</div>`;
  const top = $('#top'); if (top) { top.innerHTML = '<option value="">All topics</option>' + (cat[subj] || []).map(t => `<option>${t}</option>`).join('');
    app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { subj = b.dataset.s; home(); }); }
  app.querySelectorAll('[data-kid]').forEach(b => b.onclick = () => { child = ME.children.find(c => c.id === +b.dataset.kid); LS.set('child', child.id); home(); });
  $('#yr').onchange = async e => { await api('/children/' + child.id, { method: 'PATCH', body: { year: e.target.value } }); child.year = e.target.value; home(); };
  $('#addkid').onclick = () => addChild(false);
  if (subs.length) {
    const q = (extra, mode, n) => startSession(`/questions?childId=${child.id}&n=${n}&year=${encodeURIComponent(child.year)}${extra}`, mode);
    const sel = () => `&subject=${encodeURIComponent(subj)}&topic=${encodeURIComponent(top.value)}`;
    $('#go').onclick = () => q(sel(), 'practice', 10); $('#blitz').onclick = () => q(sel(), 'blitz', 25); $('#holiday').onclick = () => q('', 'holiday', 20);
    $('#mock').onclick = async () => { try { const r = await api('/mocks', { body: { childId: child.id, n: 15 } }); begin(r.questions, 'mock', { mockId: r.mockId, limit: r.limitSecs }); } catch (e) { alert(e.message); } };
  }
  api(`/children/${child.id}/stats`).then(({ stats: s }) => { const b = $('#gbar'); if (!b) return;
    b.style.width = Math.min(100, s.today / DAILY_GOAL * 100) + '%';
    $('#gtxt').textContent = `${s.today} of ${DAILY_GOAL} questions today` + (s.streak ? ` · ${s.streak}-day streak` : ''); }).catch(() => {});
}
function locked() { app.innerHTML = `<div class="auth"><p class="eyebrow">Subscription</p><h1>Practice is paused</h1><div class="rule"></div><p>Your free trial or subscription has ended. Please contact UPlus Education to renew. Your child's progress is saved and will be here when you return.</p><button class="btn" id="p">View progress</button></div>`; $('#p').onclick = parentView; }

// ---------- session ----------
async function startSession(path, mode) {
  try { const r = await api(path); if (!r.questions.length) return alert('No questions here yet.'); begin(r.questions, mode, {}); } catch (e) { e.status === 402 ? locked() : alert(e.message); }
}
function begin(qs, mode, extra) {
  nav.style.display = 'none'; // focus mode
  S = { qs, mode, i: 0, right: 0, answered: 0, results: [], t0: Date.now(), ...extra };
  if (mode === 'mock') { S.deadline = Date.now() + S.limit * 1000; S.tick = setInterval(timerTick, 500); }
  question();
}
function timerTick() { if (!S || S.mode !== 'mock') return; const left = Math.ceil((S.deadline - Date.now()) / 1000), el = $('#timer');
  if (el) { el.textContent = fmt(left); el.classList.toggle('low', left < 60); } if (left <= 0) finish(true); }
const modeName = { practice: 'Practice', blitz: 'Flashcard blitz', mock: 'Mock test', holiday: 'Holiday challenge' };
function question() {
  const q = S.qs[S.i]; S.qStart = Date.now(); S.busy = false; S.image = null;
  const body = q.type === 'mc' ? q.options.map((o, i) => `<button class="opt" data-o="${esc(o)}"><span class="k">${'ABCDEFGH'[i]}</span>${esc(o)}</button>`).join('')
    : q.type === 'written' ? `<p class="hint">Do your working on paper, then add a photo of it, or type your answer below.</p>
      <label class="photo-btn" for="photo">${ico('camera')}Take or choose a photo of your working</label><input type="file" id="photo" accept="image/*" capture="environment" hidden><div id="prev"></div>
      <label>Typed answer <span style="text-transform:none;letter-spacing:0;font-weight:400">(optional if you add a photo)</span></label><textarea id="ans" rows="3" placeholder="Type your final answer or working"></textarea><button id="sub" class="btn block" style="margin-top:12px">Submit for marking</button>`
    : `<input type="text" id="ans" class="answer-in" autocomplete="off" placeholder="Type your final answer"><p class="hint" style="margin-top:8px">Work it out on paper first, then type your final answer.</p><button id="sub" class="btn block">Check answer</button>`;
  app.innerHTML = `<div class="qbar"><button class="x" id="quit" aria-label="Leave practice">${ico('x')}</button>
    <div class="pbar"><i style="width:${S.i / S.qs.length * 100}%"></i></div>
    ${S.mode === 'mock' ? `<span class="timer" id="timer">${fmt(Math.ceil((S.deadline - Date.now()) / 1000))}</span>` : `<span class="cnt">${S.i + 1} / ${S.qs.length}</span>`}</div>
    <div class="qcard ${S.mode === 'blitz' ? 'blitz' : ''}"><div class="qmeta">${esc(q.subject)} · ${esc(q.topic)}${S.mode === 'mock' ? ` · ${S.i + 1} of ${S.qs.length}` : ''}</div>
    <div class="q-text">${esc(q.q)}</div>${body}<div id="fb"></div></div>`;
  $('#quit').onclick = () => { if (confirm('Leave this practice? Your answers so far are saved.')) { clearInterval(S.tick); S = null; home(); } };
  if (q.type === 'mc') app.querySelectorAll('.opt').forEach(b => b.onclick = () => submit(q, b.dataset.o, b));
  else { const i = $('#ans'); if (q.type !== 'written') i.focus(); $('#sub').onclick = () => submit(q, i.value);
    const ph = $('#photo'); if (ph) ph.onchange = async () => { const f = ph.files[0]; if (!f) return;
      try { S.image = await shrink(f); $('#prev').innerHTML = `<div class="prev"><img src="${S.image}" alt="Your working"><button class="x2" id="rm" type="button" aria-label="Remove photo">${ico('x')}</button></div>`; $('#rm').onclick = () => { S.image = null; ph.value = ''; $('#prev').innerHTML = ''; }; }
      catch { $('#prev').innerHTML = '<div class="err">That photo could not be opened. Try a JPEG or PNG, or type your answer.</div>'; } };
    if (q.type !== 'written') i.onkeydown = e => e.key === 'Enter' && submit(q, i.value); }
}
// Shrink a phone photo (often 5MB+) to a ~300KB JPEG before upload.
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try { const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const sc = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.8); } finally { URL.revokeObjectURL(url); }
}
async function submit(q, given, btn, selfCorrect) {
  if (S.busy) return; if (q.type !== 'mc' && selfCorrect === undefined && !String(given).trim() && !(q.type === 'written' && S.image)) return; S.busy = true;
  const ms = Date.now() - S.qStart, mode = S.mode;
  if (q.type === 'written' && selfCorrect === undefined) { const sb = $('#sub'); if (sb) sb.disabled = true; $('#fb').innerHTML = `<div class="fb"><strong>${S.image ? 'Reading your working…' : 'Marking your answer…'}</strong></div>`; }
  let r; try { r = await api('/answer', { body: { childId: child.id, qid: q.id, given, ms, mode, mockId: S.mockId, selfCorrect, image: selfCorrect === undefined && q.type === 'written' ? S.image : undefined } }); }
  catch (e) { S.busy = false; if (e.status === 402) return locked(); $('#fb').innerHTML = `<div class="fb bad"><strong>${esc(e.message)}</strong></div>`; const sb = $('#sub'); if (sb) sb.disabled = false; return; }
  if (r.unreadable) { S.busy = false; const sb = $('#sub'); if (sb) sb.disabled = false; $('#fb').innerHTML = `<div class="fb bad"><strong>We couldn't read that photo</strong><div class="ex">${esc(r.feedback)}</div></div>`; return; }
  if (r.needsSelfMark) { S.busy = false; $('#ans').disabled = true; $('#sub').remove();
    $('#fb').innerHTML = `<div class="fb"><strong>Model answer</strong><div class="ex">${esc(r.answer)}<br>${esc(r.explain || '')}</div><p class="muted" style="margin:10px 0 8px">Compare this with your answer. Did you get it right?</p>
      <div class="row"><button class="btn" id="yes">I got it right</button><button class="btn secondary" id="no">Not quite</button></div></div>`;
    $('#yes').onclick = () => submit(q, given, null, true); $('#no').onclick = () => submit(q, given, null, false); return; }
  S.answered++; S.results[S.i] = r.correct; if (r.correct) S.right++;
  if (q.type === 'mc') app.querySelectorAll('.opt').forEach(b => { b.disabled = true; if (b.dataset.o === r.answer) b.classList.add('right'); else if (b === btn) b.classList.add('wrong'); });
  else { const a = $('#ans'); if (a) a.disabled = true; const sb = $('#sub'); if (sb) sb.remove(); }
  const last = S.i + 1 >= S.qs.length, quick = S.mode === 'blitz' && r.correct;
  $('#fb').innerHTML = `<div class="fb ${r.correct ? 'good' : 'bad'}"><strong>${r.correct ? 'Correct' : 'Not quite'}</strong>${r.correct ? '' : `<div class="ex">Answer: <b>${esc(r.answer)}</b></div>`}${r.explain ? `<div class="ex">${esc(r.explain)}</div>` : ''}</div>
    <div class="next-row"><button id="next" class="btn block">${last ? 'Finish' : 'Next question'}</button></div>`;
  const next = () => { if (!S || S.qs[S.i] !== q) return; S.i++; S.i < S.qs.length ? question() : finish(); };
  $('#next').onclick = next; if (quick) setTimeout(next, 700); $('#next').focus();
}
async function finish(timeUp) {
  const s = S; clearInterval(s.tick); let m = null;
  if (s.mockId) { try { m = await api(`/mocks/${s.mockId}/finish`, { body: {} }); } catch {} }
  const secs = Math.round((Date.now() - s.t0) / 1000), st = (await api(`/children/${child.id}/stats`).catch(() => ({}))).stats || {};
  S = null; setNav('home');
  const score = m ? m.score : s.right, total = m ? m.total : s.qs.length, pct = Math.round(score / total * 100);
  const msg = timeUp ? 'Time ran out. Unanswered questions count as incorrect.' : pct >= 90 ? 'Excellent result.' : pct >= 70 ? 'Solid work.' : pct >= 50 ? 'A good effort. A little more practice on the weaker topics will help.' : 'Keep going. Regular short sessions make the biggest difference.';
  app.innerHTML = `<div class="result"><p class="eyebrow">${modeName[s.mode] || 'Practice'} complete</p><div class="score">${score}<small> / ${total}</small></div><p style="font-size:1.05rem;margin-top:10px">${msg}</p>
    ${strip([[fmt(secs), 'Time taken'], [pct + '%', 'Accuracy'], [st.streak ?? '–', 'Day streak']])}
    ${s.mode === 'mock' ? `<p class="muted">Mock tests are saved so your parents can follow your progress.</p>` : ''}
    <div class="row" style="margin-top:16px"><button id="again" class="btn">Back to practice</button><button class="btn secondary" id="prog">View my progress</button></div></div>`;
  $('#again').onclick = home; $('#prog').onclick = mine;
}

// ---------- dashboards ----------
const chart = last14 => { const mx = Math.max(1, ...last14.map(d => d.n)), td = new Date().toISOString().slice(0, 10);
  return `<div class="chart">${last14.map(d => `<div class="b" title="${d.day}: ${d.n} questions">${d.n || ''}<i class="${d.n ? (d.day === td ? 'today' : '') : 'zero'}" style="height:${d.n ? Math.max(5, d.n / mx * 100) : 0}%"></i></div>`).join('')}</div><div class="axis">${last14.map(d => `<span>${+d.day.slice(8)}</span>`).join('')}</div>`; };
const topicList = topics => topics.length ? `<div class="tl">${topics.map(t => { const a = Math.round(t.right / t.n * 100);
  return `<div class="t"><b>${esc(t.subject)} · ${esc(t.topic)}</b><span class="a" style="color:${accColor(a)}">${a}%</span><span class="sub">${t.n} answered${a < 55 && t.n >= 3 ? ' · needs more practice' : ''}</span><div class="meter"><i style="width:${a}%;background:${accColor(a)}"></i></div></div>`; }).join('')}</div>` : '<p class="empty">No practice yet. Topics will appear here once questions have been answered.</p>';
const mockTable = mocks => mocks.length ? `<table><tr><th>Date</th><th>Score</th><th>Time used</th></tr>${mocks.slice().reverse().map(m => `<tr><td>${new Date(m.finished).toLocaleDateString('en-AU')}</td><td>${m.score} / ${m.total} ${tag(Math.round(m.score / m.total * 100))}</td><td class="num">${fmt(Math.round((m.finished - m.started) / 1000))} of ${fmt(m.limit_s)}</td></tr>`).join('')}</table>` : '<p class="empty">No mock tests completed yet.</p>';

async function mine() {
  setNav('mine'); if (!child) return;
  const { stats: s } = await api(`/children/${child.id}/stats`);
  app.innerHTML = `<div class="head"><p class="eyebrow">My progress</p><h1>${esc(child.name)}</h1></div>
    ${strip([[s.total, 'Questions answered'], [s.today, 'Today'], [s.streak, 'Day streak'], [s.xp, 'Points']])}
    <h3>Last 14 days</h3>${chart(s.last14)}<h3>By topic</h3>${topicList(s.topics)}`;
}
async function parentView() {
  setNav('parent');
  const all = await Promise.all(ME.children.map(c => api(`/children/${c.id}/stats`)));
  app.innerHTML = `<div class="head"><p class="eyebrow">Parent dashboard</p><h1>${esc(ME.user.name)}</h1><p class="muted" style="margin-top:6px">${ME.user.paidUntil ? 'Subscription active until ' + esc(ME.user.paidUntil) : 'Free trial'}</p></div>` +
    (all.map(({ child: c, stats: s }) => `<div class="panel"><div class="childhead"><h2>${esc(c.name)}</h2><span>${esc(c.year)}</span></div>
    ${strip([[s.week, 'This week'], [s.total, 'All time'], [s.accuracy + '%', 'Accuracy'], [(s.avgSecs || '–') + (s.avgSecs ? 's' : ''), 'Avg per question'], [s.activeDays, 'Days practised'], [s.streak, 'Day streak']])}
    <h3>Daily activity, last 14 days</h3>${chart(s.last14)}<h3>Mock tests</h3>${mockTable(s.mocks)}<h3>Topic strengths</h3>${topicList(s.topics)}</div>`).join('') || '<p class="empty">No children added yet.</p>');
}

// ---------- admin ----------
async function admin() {
  setNav('admin'); const { families, signupCode } = await api('/admin/families');
  app.innerHTML = `<div class="head"><p class="eyebrow">Administration</p><h1>Families</h1><p class="muted" style="margin-top:6px">Signup code for new families: <span class="tag warn">${esc(signupCode)}</span></p></div>
  <div class="panel" style="padding:8px 20px">${families.length ? `<table><tr><th>Family</th><th>Children (week / total)</th><th>Access</th><th></th></tr>${families.map(f => `<tr>
    <td><b>${esc(f.name)}</b><br><span class="muted">${esc(f.email)}</span></td>
    <td>${f.children.map(c => `${esc(c.name)} (${esc(c.year)}): ${c.week} / ${c.total}`).join('<br>') || '–'}</td>
    <td>${f.paid ? '<span class="tag good">Active</span>' : '<span class="tag bad">Expired</span>'}<br><span class="muted">${esc(f.paid_until || 'Trial')}</span></td>
    <td style="white-space:nowrap"><button class="btn small" data-w="4" data-u="${f.id}">+4 weeks</button> <button class="btn small secondary" data-w="10" data-u="${f.id}">+10 weeks</button></td></tr>`).join('')}</table>` : '<p class="empty">No families have signed up yet.</p>'}</div>`;
  app.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => { await api('/admin/paid', { body: { userId: +b.dataset.u, addWeeks: +b.dataset.w } }); admin(); });
}

// ---------- booklet import (admin) ----------
async function importScreen() {
  setNav('import');
  const { drafts, years } = await api('/admin/drafts');
  app.innerHTML = `<div class="head"><p class="eyebrow">Administration</p><h1>Import a booklet</h1><p class="muted" style="margin-top:6px">Drop a PDF or page photos. Questions are extracted into a review list; nothing goes live until you approve it.</p></div>
    <div class="panel"><div class="row"><div><label style="margin-top:0">Year group</label><input type="text" id="iy" list="yl" value="${esc(LS.get('iy') || years[0] || 'Year 5')}"><datalist id="yl">${years.map(y => `<option>${y}</option>`).join('')}</datalist></div>
    <div><label style="margin-top:0">Subject (optional)</label><input type="text" id="is" placeholder="Maths, English… or leave blank" value="${esc(LS.get('is') || '')}"></div></div>
    <div id="drop" class="drop">${ico('upload')}<br>Drag and drop a booklet here, or click to choose<br><span class="muted">PDF, PNG or JPEG · up to 30 MB · upload long booklets in parts</span></div>
    <input type="file" id="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple hidden><div id="st" class="muted" style="margin-top:10px"></div></div>
    <div id="queue"></div>`;
  const drop = $('#drop'), st = $('#st');
  const upload = async files => {
    const year = $('#iy').value.trim(), subject = $('#is').value.trim(); LS.set('iy', year); LS.set('is', subject);
    if (!year) return (st.textContent = 'Enter a year group first.');
    for (const f of files) {
      st.textContent = `Reading ${f.name}… this can take a minute or two.`;
      try { const r = await fetch(`/api/admin/import?year=${encodeURIComponent(year)}&subject=${encodeURIComponent(subject)}`, { method: 'POST', headers: { 'content-type': f.type }, body: f });
        const j = await r.json(); if (!r.ok) throw new Error(j.error); st.textContent = `${f.name}: ${j.added} questions found.`; }
      catch (e) { st.innerHTML = `<span class="err">${esc(f.name)}: ${esc(e.message)}</span>`; return; }
    }
    importScreen();
  };
  drop.onclick = () => $('#file').click(); $('#file').onchange = e => upload([...e.target.files]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); };
  renderQueue(drafts);
}
function renderQueue(drafts) {
  const el = $('#queue'); if (!drafts.length) { el.innerHTML = '<p class="empty">No questions are waiting for review.</p>'; return; }
  const patch = (id, body) => api('/admin/drafts/' + id, { method: 'PATCH', body });
  el.innerHTML = `<div class="panel"><h2>Review (${drafts.length})</h2><p class="muted">Check each question and answer. Flagged items need your attention. Approved questions are available to students immediately.</p>
    <button class="btn" id="all">Approve all (${drafts.length}); incomplete ones are skipped</button></div>` + drafts.map(d => `<div class="panel" data-id="${d.id}">
    <div style="margin-bottom:6px">${d.answerFromBooklet ? '' : '<span class="tag warn">Answer written by AI: check it</span> '}${d.hasFigure ? '<span class="tag warn">Refers to a diagram</span> ' : ''}${d.page ? `<span class="tag">Page ${d.page}</span>` : ''}</div>
    <div class="row"><div><label>Subject</label><input type="text" data-k="subject" value="${esc(d.subject)}"></div><div><label>Topic</label><input type="text" data-k="topic" value="${esc(d.topic)}"></div>
    <div><label>Type</label><select data-k="type">${['mc', 'short', 'written'].map(t => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <label>Question</label><textarea data-k="q" rows="3">${esc(d.q)}</textarea>
    <label>Options (one per line, multiple choice only)</label><textarea data-k="options" rows="3">${esc(d.options.join('\n'))}</textarea>
    <label>Correct answer${d.type === 'mc' ? ' (must match an option exactly)' : ' (separate accepted alternatives with |)'}</label><input type="text" data-k="answer" value="${esc(d.answer.join(' | '))}">
    <label>Explanation</label><input type="text" data-k="explain" value="${esc(d.explain)}">
    <div class="err"></div><button class="btn small" data-a="approve">Approve</button> <button class="btn small secondary" data-a="reject">Reject</button></div>`).join('');
  el.querySelectorAll('[data-k]').forEach(i => i.onchange = () => { const id = i.closest('[data-id]').dataset.id, k = i.dataset.k, v = i.value;
    patch(id, { [k]: k === 'options' ? v.split('\n') : k === 'answer' ? v.split('|') : v }); });
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { const c = b.closest('[data-id]'), id = c.dataset.id;
    document.activeElement && document.activeElement.blur(); await new Promise(r => setTimeout(r, 150));
    try { await api(`/admin/drafts/${id}/${b.dataset.a}`, { body: {} }); c.remove(); } catch (e) { c.querySelector('.err').textContent = e.message; } });
  $('#all').onclick = async () => { const r = await api('/admin/drafts/approve-all', { body: {} }); alert(`Approved ${r.approved}.` + (r.skipped ? ` ${r.skipped} skipped; fix their answers or options first.` : '')); importScreen(); };
}
boot();
})();
