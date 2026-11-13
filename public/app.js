(() => {
const $ = s => document.querySelector(s), app = $('#app'), nav = $('#nav');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let CFG = {}, ME = null, child = null, S = null, subj = null;
const DAILY_GOAL = 10;
const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let LANG = LS.get('lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
const t = (s, v) => { let r = (LANG === 'zh' && window.ZH && window.ZH[s]) || s; if (v) for (const k in v) r = r.split('{' + k + '}').join(v[k]); return r; };
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const yl = y => { const m = LANG === 'zh' && /^Year (\d{1,2})$/.exec(y || ''); return m && CN[+m[1]] ? CN[+m[1]] + '年级' : y; };
let cur = null; // current screen renderer, re-run when the language changes
function applyLang() { document.documentElement.lang = LANG === 'zh' ? 'zh-Hans' : 'en'; document.title = t('UPlus Ascend'); const b = $('#lang'); if (b) b.textContent = LANG === 'zh' ? 'English' : '中文'; }
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
  import: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  eraser: '<path d="M4 16l9-9 6 6-6 6H8z"/><path d="M13 19h7"/>',
  undo: '<path d="M4 9h11a5 5 0 010 10h-4"/><path d="M8 5L4 9l4 4"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3"/>'
};
const ico = n => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.body ? (opts.method || 'POST') : (opts.method || 'GET'), headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(t(j.error || 'Something went wrong')); e.status = r.status; throw e; }
  return j;
}
async function boot() {
  try { CFG = await (await fetch('/api/config')).json(); } catch { CFG = {}; }
  try { ME = await api('/me'); } catch { ME = null; }
  if (!ME) return authScreen();
  const saved = +LS.get('child'); child = ME.children.find(c => c.id === saved) || ME.children[0] || null;
  ME.user.role === 'admin' ? admin() : child ? home() : addChild(true);
}
function setNav(active) {
  nav.style.display = ''; const lb = $('#lang'); if (lb) lb.style.display = '';
  if (!ME) { nav.innerHTML = ''; return; }
  const items = ME.user.role === 'admin' ? [['admin', 'users', t('Families')], ['qbank', 'list', t('Questions')], ['import', 'import', t('Import')]] : [['home', 'home', t('Practice')], ['mine', 'chart', t('Progress')], ['parent', 'users', t('Parents')]];
  nav.innerHTML = items.map(([k, i, l]) => `<button data-nav="${k}" class="${k === active ? 'on' : ''}">${ico(i)}${l}</button>`).join('') + `<button data-nav="out">${ico('out')}${t('Log out')}</button>`;
}
nav.onclick = e => { const k = e.target.closest('[data-nav]')?.dataset.nav; if (!k) return; if (S) clearInterval(S.tick); S = null;
  ({ home, mine, parent: parentView, admin, qbank, import: importScreen, out: async () => { await api('/logout', { body: {} }); ME = null; authScreen(); } })[k](); };
$('#lang').onclick = () => { LANG = LANG === 'zh' ? 'en' : 'zh'; LS.set('lang', LANG); applyLang(); if (cur) cur(); };
applyLang();

// ---------- shared bits ----------
const valuesHtml = () => `<div class="values"><span>Uplift</span><span>Persevere</span><span>Lead</span><span>Understand</span><span>Support</span></div><div class="values zh"><span>鼓舞</span><span>坚持</span><span>引导</span><span>理解</span><span>支持</span></div>`;
const sl = x => t(x);
const accColor = a => a >= 75 ? 'var(--good)' : a >= 55 ? 'var(--mid)' : 'var(--bad)';
const tag = a => `<span class="tag ${a >= 75 ? 'good' : a >= 55 ? 'warn' : 'bad'}">${a}%</span>`;
const strip = items => `<div class="strip">${items.map(([v, l]) => `<div class="m"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
const greet = () => { const h = new Date().getHours(); return t(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'); };
const today = () => new Date().toLocaleDateString(LANG === 'zh' ? 'zh-CN' : 'en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

// ---------- auth ----------
function authScreen(mode = 'login', err = '') {
  cur = () => authScreen(mode, ''); setNav();
  app.innerHTML = `<div class="auth">
  <p class="eyebrow">${t('UPlus Ascend')} · ${t('Student practice portal')}</p><h1>${mode === 'signup' ? t('Create a family account') : t('Sign in')}</h1><div class="rule"></div>
  <div class="tabs"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">${t('Sign in')}</button><button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">${t('New family')}</button></div>
  <form id="f">${mode === 'signup' ? `<label>${t('Parent name')}</label><input type="text" name="name" required>` : ''}
  <label>${t('Email')}</label><input type="email" name="email" required autocomplete="username">
  <label>${mode === 'signup' ? t('Password (8+ characters)') : t('Password')}</label><input type="password" name="password" required autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">
  ${mode === 'signup' ? `<label>${t('Family code (provided by UPlus)')}</label><input type="text" name="code" required>` : ''}
  <div class="err">${esc(err)}</div><button class="btn block" style="margin-top:8px">${mode === 'signup' ? t('Create account') : t('Sign in')}</button></form>
  ${mode === 'login' && CFG.demo ? `<p class="muted" style="margin-top:14px">${t('Demo account: {x}', { x: 'parent@uplus.test / parent123' })}</p>` : ''}
  <div class="brandfoot">${valuesHtml()}</div></div>`;
  app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => authScreen(b.dataset.m));
  $('#f').onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
    try { await api(mode === 'signup' ? '/signup' : '/login', { body }); boot(); } catch (x) { authScreen(mode, x.message); } };
}
function addChild(first) {
  cur = () => addChild(first); setNav('home');
  app.innerHTML = `<div class="auth"><p class="eyebrow">${first ? t('Get started') : t('Family')}</p><h1>${first ? t('Add your first child') : t('Add a child')}</h1><div class="rule"></div>
  <form id="f"><label>${t('First name')}</label><input type="text" name="name" required maxlength="40">
  <label>${t('Year group')}</label><select name="year">${ME.years.map(y => `<option value="${esc(y)}">${esc(yl(y))}</option>`).join('')}</select>
  <div class="err" id="e"></div><button class="btn block" style="margin-top:8px">${t('Add child')}</button>${first ? '' : `<button type="button" class="btn secondary block" id="cancel" style="margin-top:8px">${t('Cancel')}</button>`}</form></div>`;
  if (!first) $('#cancel').onclick = home;
  $('#f').onsubmit = async e => { e.preventDefault(); try { const r = await api('/children', { body: Object.fromEntries(new FormData(e.target)) }); LS.set('child', r.id); await boot(); } catch (x) { $('#e').textContent = x.message; } };
}

// ---------- practice home ----------
function home() {
  cur = home; setNav('home'); if (!ME.user.paid) return locked();
  const cat = ME.catalog[child.year] || {}, subs = Object.keys(cat); if (!subs.includes(subj)) subj = subs[0];
  app.innerHTML = `<div class="head"><p class="eyebrow">${today()}</p><h1>${greet()}${LANG === 'zh' ? '，' : ', '}${esc(child.name)}</h1>
    <div class="goal"><div class="pbar"><i id="gbar" style="width:0"></i></div><span id="gtxt">&nbsp;</span></div></div>
  <div class="toolbar"><div><label>${t('Student')}</label><div class="sc">${ME.children.map(c => `<button data-kid="${c.id}" class="${c.id === child.id ? 'on' : ''}">${esc(c.name)}</button>`).join('')}<button id="addkid">${t('+ Add')}</button></div></div>
    <div class="yr"><label>${t('Year group')}</label><select id="yr">${ME.years.map(y => `<option value="${esc(y)}" ${y === child.year ? 'selected' : ''}>${esc(yl(y))}</option>`).join('')}</select></div></div>
  ${subs.length ? `<div class="panel"><label style="margin-top:0">${t('Subject')}</label><div class="sc" id="subs">${subs.map(s => `<button data-s="${esc(s)}" class="${s === subj ? 'on' : ''}">${esc(sl(s))}</button>`).join('')}</div>
    <label>${t('Topic')}</label><select id="top"></select>
    <button class="btn cta block" id="go" style="margin-top:18px"><span>${t('Start practice')} <small>&nbsp;${t('10 questions')}</small></span>${ico('arrow')}</button></div>
  <label style="margin-top:26px">${t('Other ways to practise')}</label>
  <div class="list">
    <button class="lrow" id="blitz">${ico('bolt')}<span><b>${t('Flashcard blitz')}</b><small>${t('25 quick questions, one after another')}</small></span>${ico('arrow')}</button>
    <button class="lrow" id="mock">${ico('clock')}<span><b>${t('Timed mock test')}</b><small>${t('15 questions against the clock; saved for your parents to see')}</small></span>${ico('arrow')}</button>
    <button class="lrow" id="holiday">${ico('sun')}<span><b>${t('Holiday challenge')}</b><small>${t('20 mixed questions from across the year')}</small></span>${ico('arrow')}</button></div>`
    : `<div class="panel"><p class="muted" style="margin:0">${t('There are no questions for {y} yet.', { y: esc(yl(child.year)) })}</p></div>`}
  <div class="brandfoot">${valuesHtml()}</div>`;
  const top = $('#top'); if (top) { top.innerHTML = `<option value="">${t('All topics')}</option>` + (cat[subj] || []).map(x => `<option>${esc(x)}</option>`).join('');
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
    $('#gtxt').textContent = t('{n} of {g} questions today', { n: s.today, g: DAILY_GOAL }) + (s.streak ? ' · ' + t('{n}-day streak', { n: s.streak }) : ''); }).catch(() => {});
}
function locked() { cur = locked; app.innerHTML = `<div class="auth"><p class="eyebrow">${t('Subscription')}</p><h1>${t('Practice is paused')}</h1><div class="rule"></div><p>${t("Your free trial or subscription has ended. Please contact UPlus Education to renew. Your child's progress is saved and will be here when you return.")}</p><button class="btn" id="p">${t('View progress')}</button></div>`; $('#p').onclick = parentView; }

// ---------- session ----------
async function startSession(path, mode) {
  try { const r = await api(path); if (!r.questions.length) return alert(t('No questions here yet.')); begin(r.questions, mode, {}); } catch (e) { e.status === 402 ? locked() : alert(e.message); }
}
function begin(qs, mode, extra) {
  cur = null; nav.style.display = 'none'; $('#lang').style.display = 'none'; // focus mode
  S = { qs, mode, i: 0, right: 0, answered: 0, results: [], t0: Date.now(), ...extra };
  if (mode === 'mock') { S.deadline = Date.now() + S.limit * 1000; S.tick = setInterval(timerTick, 500); }
  question();
}
function timerTick() { if (!S || S.mode !== 'mock') return; const left = Math.ceil((S.deadline - Date.now()) / 1000), el = $('#timer');
  if (el) { el.textContent = fmt(left); el.classList.toggle('low', left < 60); } if (left <= 0) finish(true); }
const modeName = () => ({ practice: t('Practice'), blitz: t('Flashcard blitz'), mock: t('Mock test'), holiday: t('Holiday challenge') });
function question() {
  const q = S.qs[S.i]; S.qStart = Date.now(); S.busy = false; S.image = null; S.pad = null;
  const written = q.type === 'written', key = written ? 'im_w' : 'im_s';
  const modes = written ? [['photo', t('Photo of paper')], ['pad', t('Write on screen')], ['type', t('Type')]] : [['type', t('Type')], ['pad', t('Write on screen')]];
  let im = LS.get(key); if (!modes.some(m => m[0] === im)) im = written ? (innerWidth < 700 ? 'photo' : 'pad') : 'type'; S.input = im;
  const body = q.type === 'mc' ? q.options.map((o, i) => `<button class="opt" data-o="${esc(o)}"><span class="k">${'ABCDEFGH'[i]}</span>${esc(o)}</button>`).join('')
    : `<div class="sc full" id="modes">${modes.map(([k, l]) => `<button type="button" data-im="${k}">${l}</button>`).join('')}</div>
      <div style="margin-top:14px">
      ${written ? `<div id="pane-photo" hidden><p class="hint">${t('Do your working on paper, then add a photo of it.')}</p>
        <label class="photo-btn" for="photo">${ico('camera')}${t('Take or choose a photo of your working')}</label><input type="file" id="photo" accept="image/*" capture="environment" hidden><div id="prev"></div></div>` : ''}
      <div id="pane-pad" hidden><p class="hint">${t('Write with your finger, a stylus or a mouse. Write clearly and keep your working in order.')}</p><div id="padhost"></div></div>
      <div id="pane-type" hidden>${written ? `<textarea id="ans" rows="4" placeholder="${t('Type your final answer or working')}"></textarea>`
        : `<input type="text" id="ans" class="answer-in" autocomplete="off" placeholder="${t('Type your final answer')}"><p class="hint" style="margin-top:8px">${t('Work it out on paper first, then type your final answer.')}</p>`}</div></div>
      <button id="sub" class="btn block" style="margin-top:14px">${written ? t('Submit for marking') : t('Check answer')}</button>`;
  app.innerHTML = `<div class="qbar"><button class="x" id="quit" aria-label="${t('Leave practice')}">${ico('x')}</button>
    <div class="pbar"><i style="width:${S.i / S.qs.length * 100}%"></i></div>
    ${S.mode === 'mock' ? `<span class="timer" id="timer">${fmt(Math.ceil((S.deadline - Date.now()) / 1000))}</span>` : `<span class="cnt">${S.i + 1} / ${S.qs.length}</span>`}</div>
    <div class="qcard ${S.mode === 'blitz' ? 'blitz' : ''}"><div class="qmeta">${esc(sl(q.subject))} · ${esc(q.topic)}${S.mode === 'mock' ? ` · ${t('{i} of {n}', { i: S.i + 1, n: S.qs.length })}` : ''}</div>
    <div class="q-text">${esc(q.q)}</div>${body}<div id="fb"></div></div>`;
  $('#quit').onclick = () => { if (confirm(t('Leave this practice? Your answers so far are saved.'))) { clearInterval(S.tick); S = null; home(); } };
  if (q.type === 'mc') { app.querySelectorAll('.opt').forEach(b => b.onclick = () => submit(q, b.dataset.o, b)); return; }
  const setMode = m => { S.input = m; LS.set(key, m);
    app.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.im === m));
    ['photo', 'pad', 'type'].forEach(k => { const el = $('#pane-' + k); if (el) el.hidden = k !== m; });
    if (m === 'pad' && !S.pad) S.pad = makePad($('#padhost'), written ? 300 : 160);
    if (m === 'type') $('#ans').focus(); };
  app.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.im)); setMode(im);
  $('#sub').onclick = () => submit(q, $('#ans').value);
  if (!written) $('#ans').onkeydown = e => e.key === 'Enter' && submit(q, $('#ans').value);
  const ph = $('#photo'); if (ph) ph.onchange = async () => { const f = ph.files[0]; if (!f) return;
    try { S.image = await shrink(f); $('#prev').innerHTML = `<div class="prev"><img src="${S.image}" alt="${t('Your working')}"><button class="x2" id="rm" type="button" aria-label="${t('Remove photo')}">${ico('x')}</button></div>`; $('#rm').onclick = () => { S.image = null; ph.value = ''; $('#prev').innerHTML = ''; }; }
    catch { $('#prev').innerHTML = `<div class="err">${t('That photo could not be opened. Try a JPEG or PNG, or type your answer.')}</div>`; } };
}
// Drawing pad: finger, stylus or mouse. Exports a white-background JPEG for AI marking.
function makePad(host, h) {
  host.innerHTML = `<div class="pad"><canvas></canvas><div class="padbar"><button type="button" class="btn small secondary on" data-t="pen">${ico('pencil')}${t('Pen')}</button><button type="button" class="btn small secondary" data-t="eraser">${ico('eraser')}${t('Eraser')}</button><span style="flex:1"></span><button type="button" class="btn small secondary" data-t="undo">${ico('undo')}${t('Undo')}</button><button type="button" class="btn small secondary" data-t="clear">${ico('trash')}${t('Clear')}</button></div></div>`;
  const cv = host.querySelector('canvas'), ctx = cv.getContext('2d'); let strokes = [], cur2 = null, tool = 'pen', penSeen = false, W = 0, dpr = 1;
  const draw = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, h); strokes.forEach(st => { const p = st.pts; ctx.beginPath(); ctx.strokeStyle = ctx.fillStyle = st.eraser ? '#fff' : '#111'; ctx.lineWidth = st.eraser ? 22 : 2.8; ctx.lineCap = ctx.lineJoin = 'round';
    if (p.length === 1) { ctx.arc(p[0][0], p[0][1], ctx.lineWidth / 2, 0, 7); ctx.fill(); return; }
    ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]); ctx.stroke(); }); };
  const size = () => { const w = host.clientWidth || 300, k = W ? w / W : 1; dpr = Math.min(2, window.devicePixelRatio || 1); W = w;
    cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (k !== 1) strokes.forEach(st => st.pts.forEach(pt => pt[0] *= k)); draw(); };
  const onResize = () => { if (!document.body.contains(cv)) return removeEventListener('resize', onResize); if (host.clientWidth) size(); };
  addEventListener('resize', onResize); size();
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { if (e.pointerType === 'pen') penSeen = true; else if (e.pointerType === 'touch' && penSeen) return; // palm rejection
    e.preventDefault(); cv.setPointerCapture(e.pointerId); cur2 = { eraser: tool === 'eraser', pts: [pos(e)] }; strokes.push(cur2); draw(); });
  cv.addEventListener('pointermove', e => { if (!cur2 || (e.pointerType === 'touch' && penSeen)) return; const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; (evs.length ? evs : [e]).forEach(ev => cur2.pts.push(pos(ev))); draw(); });
  ['pointerup', 'pointercancel'].forEach(ev => cv.addEventListener(ev, () => { cur2 = null; }));
  host.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const k = b.dataset.t;
    if (k === 'pen' || k === 'eraser') { tool = k; host.querySelectorAll('[data-t=pen],[data-t=eraser]').forEach(x => x.classList.toggle('on', x === b)); }
    else if (k === 'undo') { strokes.pop(); draw(); } else if (k === 'clear') { strokes = []; draw(); } });
  const hasInk = () => strokes.some(st => !st.eraser);
  return { hasInk, export: () => { if (!hasInk()) return null; const f = Math.min(1, 1400 / cv.width), o = document.createElement('canvas'); o.width = Math.round(cv.width * f); o.height = Math.round(cv.height * f);
    o.getContext('2d').drawImage(cv, 0, 0, o.width, o.height); return o.toDataURL('image/jpeg', 0.85); } };
}
// Shrink a phone photo (often 5MB+) to a ~300KB JPEG before upload.
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try { const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const sc = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.8); } finally { URL.revokeObjectURL(url); }
}
const lockInputs = () => { app.querySelectorAll('#modes button').forEach(b => b.disabled = true); const ph = $('#padhost'); if (ph) ph.style.pointerEvents = 'none'; };
async function submit(q, given, btn, selfCorrect) {
  if (S.busy) return;
  const hand = q.type !== 'mc' && selfCorrect === undefined, img = hand ? (S.input === 'pad' ? (S.pad && S.pad.export()) : S.input === 'photo' ? S.image : null) : null;
  if (q.type !== 'mc' && S.input !== 'type') given = ''; // typed text is ignored while photo/pad is selected
  if (hand && !String(given).trim() && !img) return; S.busy = true;
  const ms = Date.now() - S.qStart, mode = S.mode, ai = q.type === 'written' || (q.type === 'short' && img);
  if (ai && selfCorrect === undefined) { const sb = $('#sub'); if (sb) sb.disabled = true; $('#fb').innerHTML = `<div class="fb"><strong>${img ? t('Reading your handwriting…') : t('Marking your answer…')}</strong></div>`; }
  let r; try { r = await api('/answer', { body: { childId: child.id, qid: q.id, given, ms, mode, mockId: S.mockId, selfCorrect, image: img || undefined, lang: LANG } }); }
  catch (e) { S.busy = false; if (e.status === 402) return locked(); $('#fb').innerHTML = `<div class="fb bad"><strong>${esc(e.message)}</strong></div>`; const sb = $('#sub'); if (sb) sb.disabled = false; return; }
  if (r.unreadable) { S.busy = false; const sb = $('#sub'); if (sb) sb.disabled = false; $('#fb').innerHTML = `<div class="fb bad"><strong>${t("We couldn't read that photo")}</strong><div class="ex">${esc(t(r.feedback))}</div></div>`; return; }
  if (r.needsSelfMark) { S.busy = false; $('#ans').disabled = true; $('#sub').remove(); lockInputs();
    $('#fb').innerHTML = `<div class="fb"><strong>${t('Model answer')}</strong><div class="ex">${esc(r.answer)}<br>${esc(r.explain || '')}</div><p class="muted" style="margin:10px 0 8px">${t('Compare this with your answer. Did you get it right?')}</p>
      <div class="row"><button class="btn" id="yes">${t('I got it right')}</button><button class="btn secondary" id="no">${t('Not quite')}</button></div></div>`;
    $('#yes').onclick = () => submit(q, given, null, true); $('#no').onclick = () => submit(q, given, null, false); return; }
  S.answered++; S.results[S.i] = r.correct; if (r.correct) S.right++;
  if (q.type === 'mc') app.querySelectorAll('.opt').forEach(b => { b.disabled = true; if (b.dataset.o === r.answer) b.classList.add('right'); else if (b === btn) b.classList.add('wrong'); });
  else { const a = $('#ans'); if (a) a.disabled = true; const sb = $('#sub'); if (sb) sb.remove(); lockInputs(); }
  const last = S.i + 1 >= S.qs.length, quick = S.mode === 'blitz' && r.correct;
  $('#fb').innerHTML = `<div class="fb ${r.correct ? 'good' : 'bad'}"><strong>${r.correct ? t('Correct') : t('Not quite')}</strong>${r.correct ? '' : `<div class="ex">${t('Answer: ')}<b>${esc(r.answer)}</b></div>`}${r.explain ? `<div class="ex">${esc(r.explain)}</div>` : ''}</div>
    <div class="next-row"><button id="next" class="btn block">${last ? t('Finish') : t('Next question')}</button></div>`;
  const next = () => { if (!S || S.qs[S.i] !== q) return; S.i++; S.i < S.qs.length ? question() : finish(); };
  $('#next').onclick = next; if (quick) setTimeout(next, 700); $('#next').focus();
}
async function finish(timeUp) {
  const s = S; clearInterval(s.tick); let m = null;
  if (s.mockId) { try { m = await api(`/mocks/${s.mockId}/finish`, { body: {} }); } catch {} }
  const secs = Math.round((Date.now() - s.t0) / 1000), st = (await api(`/children/${child.id}/stats`).catch(() => ({}))).stats || {};
  S = null; setNav('home');
  const score = m ? m.score : s.right, total = m ? m.total : s.qs.length, pct = Math.round(score / total * 100);
  const render = () => { cur = render; setNav('home');
    const msg = timeUp ? t('Time ran out. Unanswered questions count as incorrect.') : pct >= 90 ? t('Excellent result.') : pct >= 70 ? t('Solid work.') : pct >= 50 ? t('A good effort. A little more practice on the weaker topics will help.') : t('Keep going. Regular short sessions make the biggest difference.');
    app.innerHTML = `<div class="result"><p class="eyebrow">${t('{m} complete', { m: modeName()[s.mode] || t('Practice') })}</p><div class="score">${score}<small> / ${total}</small></div><p style="font-size:1.05rem;margin-top:10px">${msg}</p>
      ${strip([[fmt(secs), t('Time taken')], [pct + '%', t('Accuracy')], [st.streak ?? '–', t('Day streak')]])}
      ${s.mode === 'mock' ? `<p class="muted">${t('Mock tests are saved so your parents can follow your progress.')}</p>` : ''}
      <div class="row" style="margin-top:16px"><button id="again" class="btn">${t('Back to practice')}</button><button class="btn secondary" id="prog">${t('View my progress')}</button></div></div>`;
    $('#again').onclick = home; $('#prog').onclick = mine; };
  render();
}

// ---------- dashboards ----------
const chart = last14 => { const mx = Math.max(1, ...last14.map(d => d.n)), td = new Date().toISOString().slice(0, 10);
  return `<div class="chart">${last14.map(d => `<div class="b" title="${d.day}: ${d.n}">${d.n || ''}<i class="${d.n ? (d.day === td ? 'today' : '') : 'zero'}" style="height:${d.n ? Math.max(5, d.n / mx * 100) : 0}%"></i></div>`).join('')}</div><div class="axis">${last14.map(d => `<span>${+d.day.slice(8)}</span>`).join('')}</div>`; };
const topicList = topics => topics.length ? `<div class="tl">${topics.map(x => { const a = Math.round(x.right / x.n * 100);
  return `<div class="t"><b>${esc(sl(x.subject))} · ${esc(x.topic)}</b><span class="a" style="color:${accColor(a)}">${a}%</span><span class="sub">${t('{n} answered', { n: x.n })}${a < 55 && x.n >= 3 ? t(' · needs more practice') : ''}</span><div class="meter"><i style="width:${a}%;background:${accColor(a)}"></i></div></div>`; }).join('')}</div>` : `<p class="empty">${t('No practice yet. Topics will appear here once questions have been answered.')}</p>`;
const mockTable = mocks => mocks.length ? `<table><tr><th>${t('Date')}</th><th>${t('Score')}</th><th>${t('Time used')}</th></tr>${mocks.slice().reverse().map(m => `<tr><td>${new Date(m.finished).toLocaleDateString(LANG === 'zh' ? 'zh-CN' : 'en-AU')}</td><td>${m.score} / ${m.total} ${tag(Math.round(m.score / m.total * 100))}</td><td class="num">${t('{a} of {b}', { a: fmt(Math.round((m.finished - m.started) / 1000)), b: fmt(m.limit_s) })}</td></tr>`).join('')}</table>` : `<p class="empty">${t('No mock tests completed yet.')}</p>`;

async function mine() {
  cur = mine; setNav('mine'); if (!child) return;
  const { stats: s } = await api(`/children/${child.id}/stats`);
  app.innerHTML = `<div class="head"><p class="eyebrow">${t('My progress')}</p><h1>${esc(child.name)}</h1></div>
    ${strip([[s.total, t('Questions answered')], [s.today, t('Today')], [s.streak, t('Day streak')], [s.xp, t('Points')]])}
    <h3>${t('Last 14 days')}</h3>${chart(s.last14)}<h3>${t('By topic')}</h3>${topicList(s.topics)}`;
}
async function parentView() {
  cur = parentView; setNav('parent');
  const all = await Promise.all(ME.children.map(c => api(`/children/${c.id}/stats`)));
  app.innerHTML = `<div class="head"><p class="eyebrow">${t('Parent dashboard')}</p><h1>${esc(ME.user.name)}</h1><p class="muted" style="margin-top:6px">${ME.user.paidUntil ? t('Subscription active until {d}', { d: esc(ME.user.paidUntil) }) : t('Free trial')}</p></div>` +
    (all.map(({ child: c, stats: s }) => `<div class="panel"><div class="childhead"><h2>${esc(c.name)}</h2><span>${esc(yl(c.year))}</span></div>
    ${strip([[s.week, t('This week')], [s.total, t('All time')], [s.accuracy + '%', t('Accuracy')], [s.avgSecs ? s.avgSecs + t('s') : '–', t('Avg per question')], [s.activeDays, t('Days practised')], [s.streak, t('Day streak')]])}
    <h3>${t('Daily activity, last 14 days')}</h3>${chart(s.last14)}<h3>${t('Mock tests')}</h3>${mockTable(s.mocks)}<h3>${t('Topic strengths')}</h3>${topicList(s.topics)}</div>`).join('') || `<p class="empty">${t('No children added yet.')}</p>`);
}

// ---------- admin: families ----------
async function admin() {
  cur = admin; setNav('admin'); const { families, signupCode } = await api('/admin/families');
  app.innerHTML = `<div class="head"><p class="eyebrow">${t('Administration')}</p><h1>${t('Families')}</h1><p class="muted" style="margin-top:6px">${t('Signup code for new families: ')}<span class="tag warn">${esc(signupCode)}</span></p></div>
  <div class="panel" style="padding:8px 20px">${families.length ? `<table><tr><th>${t('Family')}</th><th>${t('Children (week / total)')}</th><th>${t('Access')}</th><th></th></tr>${families.map(f => `<tr>
    <td><b>${esc(f.name)}</b><br><span class="muted">${esc(f.email)}</span></td>
    <td>${f.children.map(c => `${esc(c.name)} (${esc(yl(c.year))}): ${c.week} / ${c.total}`).join('<br>') || '–'}</td>
    <td>${f.paid ? `<span class="tag good">${t('Active')}</span>` : `<span class="tag bad">${t('Expired')}</span>`}<br><span class="muted">${esc(f.paid_until || t('Trial'))}</span></td>
    <td style="white-space:nowrap"><button class="btn small" data-w="4" data-u="${f.id}">${t('+4 weeks')}</button> <button class="btn small secondary" data-w="10" data-u="${f.id}">${t('+10 weeks')}</button></td></tr>`).join('')}</table>` : `<p class="empty">${t('No families have signed up yet.')}</p>`}</div>`;
  app.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => { await api('/admin/paid', { body: { userId: +b.dataset.u, addWeeks: +b.dataset.w } }); admin(); });
}

// ---------- admin: question bank (manual add / edit / remove) ----------
let QB = { q: '', year: '', subject: '' };
const TYPES = () => [['mc', t('Multiple choice')], ['short', t('Short answer')], ['written', t('Written answer')]];
const qForm = (d, f) => `<div class="row"><div><label>${t('Year group')}</label><input type="text" data-f="year" list="dl-y" value="${esc(d.year)}"></div>
  <div><label>${t('Subject')}</label><input type="text" data-f="subject" list="dl-s" value="${esc(d.subject)}"></div>
  <div><label>${t('Topic')}</label><input type="text" data-f="topic" list="dl-t" value="${esc(d.topic)}"></div>
  <div><label>${t('Question type')}</label><select data-f="type">${TYPES().map(([k, l]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
  <label>${t('Question')}</label><textarea data-f="q" rows="3">${esc(d.q)}</textarea>
  <div data-opts><label>${t('Options (one per line, multiple choice only)')}</label><textarea data-f="options" rows="4">${esc((d.options || []).join('\n'))}</textarea></div>
  <label>${t('Correct answer')}<span data-ah="mc"> ${t(' (must match an option exactly)')}</span><span data-ah="other"> ${t(' (separate accepted alternatives with |)')}</span></label><input type="text" data-f="answer" value="${esc((d.answer || []).join(' | '))}">
  <label>${t('Explanation')}</label><input type="text" data-f="explain" value="${esc(d.explain || '')}">
  <div class="err"></div><button class="btn small" data-a="save">${t('Save question')}</button> <button class="btn small secondary" data-a="cancel">${t('Cancel')}</button>`;
function wireForm(el, onSave, onCancel) {
  const sync = () => { const mc = el.querySelector('[data-f=type]').value === 'mc'; el.querySelector('[data-opts]').hidden = !mc; el.querySelector('[data-ah=mc]').hidden = !mc; el.querySelector('[data-ah=other]').hidden = mc; };
  el.querySelector('[data-f=type]').onchange = sync; sync();
  const read = () => { const g = k => el.querySelector(`[data-f=${k}]`).value; return { year: g('year'), subject: g('subject'), topic: g('topic'), type: g('type'), q: g('q'), options: g('options').split('\n'), answer: g('answer').split('|'), explain: g('explain') }; };
  el.querySelector('[data-a=cancel]').onclick = onCancel;
  el.querySelector('[data-a=save]').onclick = async () => { try { await onSave(read()); } catch (e) { el.querySelector('.err').textContent = e.message; } };
}
async function qbank() {
  cur = qbank; setNav('qbank');
  const r = await api('/admin/questions?' + new URLSearchParams(QB)), byId = Object.fromEntries(r.questions.map(q => [q.id, q]));
  const typeName = Object.fromEntries(TYPES());
  app.innerHTML = `<div class="head"><p class="eyebrow">${t('Administration')}</p><h1>${t('Question bank')}</h1><p class="muted" style="margin-top:6px">${t('Add questions here one at a time, or use Import to extract many from a booklet.')}</p></div>
  <datalist id="dl-y">${r.years.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl-s">${r.subjects.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl-t">${r.topics.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
  <div class="toolbar"><div style="flex:1;min-width:200px"><label style="margin-top:0">${t('Search questions')}</label><input type="text" id="fq" value="${esc(QB.q)}"></div>
    <div class="yr"><label>${t('Year group')}</label><select id="fy"><option value="">${t('All years')}</option>${r.years.map(x => `<option value="${esc(x)}" ${x === QB.year ? 'selected' : ''}>${esc(yl(x))}</option>`).join('')}</select></div>
    <div class="yr"><label>${t('Subject')}</label><select id="fs"><option value="">${t('All subjects')}</option>${r.subjects.map(x => `<option value="${esc(x)}" ${x === QB.subject ? 'selected' : ''}>${esc(sl(x))}</option>`).join('')}</select></div>
    <button class="btn" id="addq">${t('Add question')}</button></div>
  <div id="newq" class="panel" hidden></div>
  ${r.samples ? `<div class="panel"><h2>${t('Sample questions')}</h2><p class="muted">${t('The app came with {n} placeholder questions.', { n: r.samples })}</p><button class="btn small secondary" id="rmsamples">${t('Remove all sample questions')}</button></div>` : ''}
  <p class="muted">${r.total === 1 && LANG !== 'zh' ? '1 question' : t('{n} questions', { n: r.total })}${r.total > r.questions.length ? ' · ' + t('Showing the first {n}. Use the filters to narrow down.', { n: r.questions.length }) : ''}</p>
  ${r.questions.length ? r.questions.map(q => `<div class="panel qrow" data-id="${esc(q.id)}"><div class="qmain"><b>${esc(q.q.length > 150 ? q.q.slice(0, 150) + '…' : q.q)}</b>
    <div class="muted">${esc(yl(q.year))} · ${esc(sl(q.subject))} · ${esc(q.topic)} · ${typeName[q.type] || q.type}</div></div>
    <div class="qact"><button class="btn small secondary" data-a="edit">${t('Edit')}</button> <button class="btn small secondary" data-a="del">${t('Delete')}</button></div></div>`).join('') : `<p class="empty">${t('No questions match.')}</p>`}`;
  const refresh = () => { QB = { q: $('#fq').value.trim(), year: $('#fy').value, subject: $('#fs').value }; qbank(); };
  $('#fq').onchange = refresh; $('#fy').onchange = refresh; $('#fs').onchange = refresh;
  $('#addq').onclick = () => { const box = $('#newq'); box.hidden = false; box.innerHTML = `<h2>${t('Add a question')}</h2>` + qForm({ year: QB.year || r.years[0] || '', subject: QB.subject || '', topic: '', type: 'mc', q: '', options: ['', '', '', ''], answer: [], explain: '' });
    wireForm(box, async d => { await api('/admin/questions', { body: d }); qbank(); }, () => { box.hidden = true; box.innerHTML = ''; }); box.scrollIntoView({ block: 'nearest' }); };
  const rs = $('#rmsamples'); if (rs) rs.onclick = async () => { if (confirm(t('Remove the sample questions? Your own questions are not affected.'))) { await api('/admin/questions/remove-samples', { body: {} }); qbank(); } };
  app.querySelectorAll('.qrow').forEach(row => { const id = row.dataset.id;
    row.querySelector('[data-a=del]').onclick = async () => { if (confirm(t('Delete this question? Students will no longer see it, but past results are kept.'))) { await api('/admin/questions/' + id, { method: 'DELETE', body: {} }); qbank(); } };
    row.querySelector('[data-a=edit]').onclick = () => { row.innerHTML = `<div style="width:100%">${qForm(byId[id])}</div>`; wireForm(row, async d => { await api('/admin/questions/' + id, { method: 'PATCH', body: d }); qbank(); }, qbank); }; });
}

// ---------- admin: booklet import ----------
async function importScreen() {
  cur = importScreen; setNav('import');
  const { drafts, years } = await api('/admin/drafts');
  app.innerHTML = `<div class="head"><p class="eyebrow">${t('Administration')}</p><h1>${t('Import a booklet')}</h1><p class="muted" style="margin-top:6px">${t('Drop a PDF or page photos. Questions are extracted into a review list; nothing goes live until you approve it.')}</p></div>
    <div class="panel"><div class="row"><div><label style="margin-top:0">${t('Year group')}</label><input type="text" id="iy" list="yl" value="${esc(LS.get('iy') || years[0] || 'Year 5')}"><datalist id="yl">${years.map(y => `<option>${esc(y)}</option>`).join('')}</datalist></div>
    <div><label style="margin-top:0">${t('Subject (optional)')}</label><input type="text" id="is" placeholder="${t('Maths, English… or leave blank')}" value="${esc(LS.get('is') || '')}"></div></div>
    <div id="drop" class="drop">${ico('upload')}<br>${t('Drag and drop a booklet here, or click to choose')}<br><span class="muted">${t('PDF, PNG or JPEG · up to 30 MB · upload long booklets in parts')}</span></div>
    <input type="file" id="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple hidden><div id="st" class="muted" style="margin-top:10px"></div></div>
    <div id="queue"></div>`;
  const drop = $('#drop'), st = $('#st');
  const upload = async files => {
    const year = $('#iy').value.trim(), subject = $('#is').value.trim(); LS.set('iy', year); LS.set('is', subject);
    if (!year) return (st.textContent = t('Enter a year group first.'));
    for (const f of files) {
      st.textContent = t('Reading {f}… this can take a minute or two.', { f: f.name });
      try { const r = await fetch(`/api/admin/import?year=${encodeURIComponent(year)}&subject=${encodeURIComponent(subject)}`, { method: 'POST', headers: { 'content-type': f.type }, body: f });
        const j = await r.json(); if (!r.ok) throw new Error(t(j.error)); st.textContent = t('{f}: {n} questions found.', { f: f.name, n: j.added }); }
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
  const el = $('#queue'); if (!drafts.length) { el.innerHTML = `<p class="empty">${t('No questions are waiting for review.')}</p>`; return; }
  const patch = (id, body) => api('/admin/drafts/' + id, { method: 'PATCH', body });
  el.innerHTML = `<div class="panel"><h2>${t('Review ({n})', { n: drafts.length })}</h2><p class="muted">${t('Check each question and answer. Flagged items need your attention. Approved questions are available to students immediately.')}</p>
    <button class="btn" id="all">${t('Approve all ({n}); incomplete ones are skipped', { n: drafts.length })}</button></div>` + drafts.map(d => `<div class="panel" data-id="${d.id}">
    <div style="margin-bottom:6px">${d.answerFromBooklet ? '' : `<span class="tag warn">${t('Answer written by AI: check it')}</span> `}${d.hasFigure ? `<span class="tag warn">${t('Refers to a diagram')}</span> ` : ''}${d.page ? `<span class="tag">${t('Page {n}', { n: d.page })}</span>` : ''}</div>
    <div class="row"><div><label>${t('Subject')}</label><input type="text" data-k="subject" value="${esc(d.subject)}"></div><div><label>${t('Topic')}</label><input type="text" data-k="topic" value="${esc(d.topic)}"></div>
    <div><label>${t('Question type')}</label><select data-k="type">${['mc', 'short', 'written'].map(x => `<option ${x === d.type ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <label>${t('Question')}</label><textarea data-k="q" rows="3">${esc(d.q)}</textarea>
    <label>${t('Options (one per line, multiple choice only)')}</label><textarea data-k="options" rows="3">${esc(d.options.join('\n'))}</textarea>
    <label>${t('Correct answer')}${d.type === 'mc' ? t(' (must match an option exactly)') : t(' (separate accepted alternatives with |)')}</label><input type="text" data-k="answer" value="${esc(d.answer.join(' | '))}">
    <label>${t('Explanation')}</label><input type="text" data-k="explain" value="${esc(d.explain)}">
    <div class="err"></div><button class="btn small" data-a="approve">${t('Approve')}</button> <button class="btn small secondary" data-a="reject">${t('Reject')}</button></div>`).join('');
  el.querySelectorAll('[data-k]').forEach(i => i.onchange = () => { const id = i.closest('[data-id]').dataset.id, k = i.dataset.k, v = i.value;
    patch(id, { [k]: k === 'options' ? v.split('\n') : k === 'answer' ? v.split('|') : v }); });
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { const c = b.closest('[data-id]'), id = c.dataset.id;
    document.activeElement && document.activeElement.blur(); await new Promise(r => setTimeout(r, 150));
    try { await api(`/admin/drafts/${id}/${b.dataset.a}`, { body: {} }); c.remove(); } catch (e) { c.querySelector('.err').textContent = e.message; } });
  $('#all').onclick = async () => { const r = await api('/admin/drafts/approve-all', { body: {} }); alert(t('Approved {n}.', { n: r.approved }) + (r.skipped ? t(' {n} skipped; fix their answers or options first.', { n: r.skipped }) : '')); importScreen(); };
}
boot();
})();
