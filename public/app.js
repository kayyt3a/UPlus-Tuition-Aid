(() => {
const $ = s => document.querySelector(s), app = $('#app'), nav = $('#nav');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let ME = null, child = null, S = null, subj = null;
const DAILY_GOAL = 10, AVATARS = ['🦊', '🐼', '🐯', '🦄', '🐸', '🐙', '🦁', '🐨'], avatar = c => AVATARS[(c.id || 0) % AVATARS.length];
const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
// Shrink a phone photo (often 5MB+) to a ~300KB JPEG before upload.
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try { const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const sc = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.8); } finally { URL.revokeObjectURL(url); }
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

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
  const items = ME.user.role === 'admin' ? [['admin', '👪', 'Families'], ['import', '📥', 'Import']] : [['home', '🏠', 'Practice'], ['mine', '📈', 'My progress'], ['parent', '👨‍👩‍👧', 'Parents']];
  nav.innerHTML = items.map(([k, i, l]) => `<button data-nav="${k}" class="${k === active ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('') + `<button data-nav="out"><span>🚪</span>Log out</button>`;
}
nav.onclick = e => { const k = e.target.closest('[data-nav]')?.dataset.nav; if (!k) return; if (S) clearInterval(S.tick); S = null;
  ({ home, mine, parent: parentView, admin, import: importScreen, out: async () => { await api('/logout', { body: {} }); ME = null; authScreen(); } })[k](); };

// ---------- shared bits ----------
const ring = (val, max, label, color = '#f1af59', track = '#ffffff33', size = 78, sw = 9) => { const r = (size - sw) / 2, c = 2 * Math.PI * r, p = Math.min(1, max ? val / max : 0);
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/></svg><b>${label}</b></div>`; };
const accColor = a => a >= 75 ? 'var(--good)' : a >= 55 ? 'var(--warn)' : 'var(--bad)';
const accPill = a => `<span class="pill ${a >= 75 ? 'good' : a >= 55 ? 'warn' : 'bad'}">${a}%</span>`;
const valuesHtml = () => `<div class="values"><span>Uplift</span><span>Persevere</span><span>Lead</span><span>Understand</span><span>Support</span></div><div class="values zh"><span>鼓舞</span><span>坚持</span><span>引导</span><span>理解</span><span>支持</span></div>`;
const stat = (i, v, l) => `<div class="stat"><i>${i}</i><b>${v}</b><span>${l}</span></div>`;

// ---------- auth ----------
function authScreen(mode = 'login', err = '') {
  setNav();
  app.innerHTML = `<div class="card hero-auth"><div class="logo-card"><img src="logo.png" alt="UPlus Education 优加教育"></div><h1>Practice that sticks</h1><p>Extra homework and holiday practice for UPlus Education families</p>${valuesHtml()}</div>
  <div class="card"><div class="tabs"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">Log in</button><button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">New family</button></div>
  <form id="f">${mode === 'signup' ? `<label>Parent name</label><input type="text" name="name" required>` : ''}
  <label>Email</label><input type="email" name="email" required autocomplete="username">
  <label>Password${mode === 'signup' ? ' (8+ characters)' : ''}</label><input type="password" name="password" required autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">
  ${mode === 'signup' ? `<label>Family code (from UPlus)</label><input type="text" name="code" required>` : ''}
  <div class="err">${esc(err)}</div><button class="block">${mode === 'signup' ? 'Create account' : 'Log in'}</button></form>
  ${mode === 'login' ? `<p class="muted" style="text-align:center">Demo: parent@uplus.test / parent123</p>` : ''}</div>`;
  app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => authScreen(b.dataset.m));
  $('#f').onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
    try { await api(mode === 'signup' ? '/signup' : '/login', { body }); boot(); } catch (x) { authScreen(mode, x.message); } };
}
function addChild(first) {
  setNav('home');
  app.innerHTML = `<div class="card"><div style="font-size:2.4rem">${first ? '👋' : '➕'}</div><h2>${first ? "Let's add your first child" : 'Add a child'}</h2>
  <form id="f"><label>First name</label><input type="text" name="name" required maxlength="40">
  <label>Year group</label><select name="year">${ME.years.map(y => `<option>${y}</option>`).join('')}</select>
  <div class="err" id="e"></div><button class="block">Add child</button>${first ? '' : '<button type="button" class="secondary block" id="cancel">Cancel</button>'}</form></div>`;
  if (!first) $('#cancel').onclick = home;
  $('#f').onsubmit = async e => { e.preventDefault(); try { const r = await api('/children', { body: Object.fromEntries(new FormData(e.target)) }); LS.set('child', r.id); await boot(); } catch (x) { $('#e').textContent = x.message; } };
}

// ---------- practice home ----------
function home() {
  setNav('home'); if (!ME.user.paid) return locked();
  const cat = ME.catalog[child.year] || {}, subs = Object.keys(cat); if (!subs.includes(subj)) subj = subs[0];
  app.innerHTML = `<div class="card hello">${`<div class="avatar">${avatar(child)}</div>`}<div><h2>Hi <em>${esc(child.name)}</em>!</h2><p id="sub-line">Ready for today's practice?</p></div><div id="goal"></div></div>
  <div class="card"><label style="margin-top:0">Who's practising?</label><div class="chips">${ME.children.map(c => `<button class="chip ${c.id === child.id ? 'on' : ''}" data-kid="${c.id}">${avatar(c)} ${esc(c.name)}</button>`).join('')}<button class="chip" id="addkid">＋ Add</button></div>
    <label>Year group</label><select id="yr">${ME.years.map(y => `<option ${y === child.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
  <div class="card"><h3 style="margin-top:0">Choose a subject</h3>
    ${subs.length ? `<div class="chips" id="subs">${subs.map(s => `<button class="chip ${s === subj ? 'on' : ''}" data-s="${esc(s)}">${s === 'Maths' ? '🔢' : s === 'English' ? '📖' : '📚'} ${esc(s)}</button>`).join('')}</div>
    <label>Topic</label><select id="top"></select>` : `<div class="empty"><div class="em">📭</div>No questions for ${esc(child.year)} yet.</div>`}</div>
  ${subs.length ? `<div class="tiles">
    <button class="tile primary" id="go"><span class="ic">📝</span><b>Practice</b><span class="d">10 questions</span></button>
    <button class="tile" id="blitz"><span class="ic">⚡</span><b>Flashcard blitz</b><span class="d">25 fast cards</span></button>
    <button class="tile" id="mock"><span class="ic">⏱️</span><b>Timed mock test</b><span class="d">15 questions, against the clock</span></button>
    <button class="tile" id="holiday"><span class="ic">🏖️</span><b>Holiday challenge</b><span class="d">20 mixed questions</span></button></div>` : ''}<div class="brandfoot">${valuesHtml()}</div>`;
  const top = $('#top'); if (top) { top.innerHTML = '<option value="">All topics</option>' + (cat[subj] || []).map(t => `<option>${t}</option>`).join('');
    app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { subj = b.dataset.s; home(); }); }
  app.querySelectorAll('[data-kid]').forEach(b => b.onclick = () => { child = ME.children.find(c => c.id === +b.dataset.kid); LS.set('child', child.id); home(); });
  $('#yr').onchange = async e => { await api('/children/' + child.id, { method: 'PATCH', body: { year: e.target.value } }); child.year = e.target.value; home(); };
  $('#addkid').onclick = () => addChild(false);
  if (!subs.length) return statsLine();
  const q = (extra, mode, n) => startSession(`/questions?childId=${child.id}&n=${n}&year=${encodeURIComponent(child.year)}${extra}`, mode);
  const sel = () => `&subject=${encodeURIComponent(subj)}&topic=${encodeURIComponent(top.value)}`;
  $('#go').onclick = () => q(sel(), 'practice', 10); $('#blitz').onclick = () => q(sel(), 'blitz', 25); $('#holiday').onclick = () => q('', 'holiday', 20);
  $('#mock').onclick = async () => { try { const r = await api('/mocks', { body: { childId: child.id, n: 15 } }); begin(r.questions, 'mock', { mockId: r.mockId, limit: r.limitSecs }); } catch (e) { alert(e.message); } };
  statsLine();
}
function statsLine() { api(`/children/${child.id}/stats`).then(({ stats: s }) => {
  const g = $('#goal'); if (g) g.innerHTML = ring(s.today, DAILY_GOAL, `${Math.min(s.today, 99)}/${DAILY_GOAL}`);
  const l = $('#sub-line'); if (l) l.textContent = s.today >= DAILY_GOAL ? '🎉 Daily goal smashed!' : s.streak ? `🔥 ${s.streak}-day streak — keep it going!` : 'Do 10 questions to start a streak!'; }).catch(() => {}); }
function locked() { app.innerHTML = `<div class="card empty"><div class="em">⏸️</div><h2>Practice is paused</h2><p>Your free trial or subscription has ended. Please contact UPlus Education to renew — progress is saved and will be here when you're back.</p><button id="p">View progress</button></div>`; $('#p').onclick = parentView; }

// ---------- session ----------
async function startSession(path, mode) {
  try { const r = await api(path); if (!r.questions.length) return alert('No questions here yet!'); begin(r.questions, mode, {}); } catch (e) { e.status === 402 ? locked() : alert(e.message); }
}
function begin(qs, mode, extra) {
  nav.style.display = 'none'; // focus mode: hide tabs during a session
  S = { qs, mode, i: 0, right: 0, answered: 0, results: [], t0: Date.now(), ...extra };
  if (mode === 'mock') { S.deadline = Date.now() + S.limit * 1000; S.tick = setInterval(timerTick, 500); }
  question();
}
function timerTick() { if (!S || S.mode !== 'mock') return; const left = Math.ceil((S.deadline - Date.now()) / 1000), el = $('#timer');
  if (el) { el.textContent = fmt(left); el.classList.toggle('low', left < 60); } if (left <= 0) finish(true); }
function question() {
  const q = S.qs[S.i]; S.qStart = Date.now(); S.busy = false; S.image = null;
  const body = q.type === 'mc' ? q.options.map((o, i) => `<button class="opt" data-o="${esc(o)}"><span class="k">${'ABCDEFGH'[i]}</span>${esc(o)}</button>`).join('')
    : q.type === 'written' ? `<div class="hint">✏️ Do your working on paper, then add a photo — or type your answer below.</div>
      <label class="photo-btn" for="photo">📷 Take or choose a photo of your working</label><input type="file" id="photo" accept="image/*" capture="environment" hidden><div id="prev"></div>
      <label>Typed answer ${'(optional if you add a photo)'}</label><textarea id="ans" rows="3" placeholder="Type your final answer or working here…"></textarea><button id="sub" class="block">Submit for marking</button>`
    : `<input type="text" id="ans" class="answer-in" autocomplete="off" placeholder="Type your final answer"><div class="hint" style="margin-top:8px">✏️ Work it out on paper first, then type your final answer.</div><button id="sub" class="block">Check</button>`;
  app.innerHTML = `<div class="qtop"><button class="x" id="quit" aria-label="Quit">✕</button>
    <div class="seg">${S.qs.map((_, i) => `<i class="${i < S.i ? (S.results[i] ? 'done' : 'bad') : i === S.i ? 'cur' : ''}"></i>`).join('')}</div>
    ${S.mode === 'mock' ? `<span class="timer" id="timer">${fmt(Math.ceil((S.deadline - Date.now()) / 1000))}</span>` : `<span class="muted">${S.i + 1}/${S.qs.length}</span>`}</div>
    <div class="card qcard ${S.mode === 'blitz' ? 'blitz' : ''}"><div class="qmeta"><span class="pill brand">${esc(q.subject)}</span><span class="pill">${esc(q.topic)}</span>${S.mode === 'blitz' ? '<span class="pill warn">⚡ blitz</span>' : ''}</div>
    <div class="q-text">${esc(q.q)}</div>${body}<div id="fb"></div></div>`;
  $('#quit').onclick = () => { if (confirm('Leave this practice? Your answers so far are saved.')) { clearInterval(S.tick); S = null; home(); } };
  if (q.type === 'mc') app.querySelectorAll('.opt').forEach(b => b.onclick = () => submit(q, b.dataset.o, b));
  else { const i = $('#ans'); if (q.type !== 'written') i.focus(); $('#sub').onclick = () => submit(q, i.value);
    const ph = $('#photo'); if (ph) ph.onchange = async () => { const f = ph.files[0]; if (!f) return;
      try { S.image = await shrink(f); $('#prev').innerHTML = `<div class="prev"><img src="${S.image}" alt="Your working"><button class="x2" id="rm" type="button" aria-label="Remove photo">✕</button></div>`; $('#rm').onclick = () => { S.image = null; ph.value = ''; $('#prev').innerHTML = ''; }; }
      catch { $('#prev').innerHTML = '<div class="err">That photo could not be opened. Try a JPEG or PNG, or type your answer.</div>'; } }; if (q.type !== 'written') i.onkeydown = e => e.key === 'Enter' && submit(q, i.value); }
}
async function submit(q, given, btn, selfCorrect) {
  if (S.busy) return; if (q.type !== 'mc' && selfCorrect === undefined && !String(given).trim() && !(q.type === 'written' && S.image)) return; S.busy = true;
  const ms = Date.now() - S.qStart, mode = S.mode;
  if (q.type === 'written' && selfCorrect === undefined) { const sb = $('#sub'); if (sb) sb.disabled = true; $('#fb').innerHTML = `<div class="fb neutral">🤖 ${S.image ? 'Reading your working…' : 'Marking your answer…'}</div>`; }
  let r; try { r = await api('/answer', { body: { childId: child.id, qid: q.id, given, ms, mode, mockId: S.mockId, selfCorrect, image: selfCorrect === undefined && q.type === 'written' ? S.image : undefined } }); }
  catch (e) { S.busy = false; if (e.status === 402) return locked(); $('#fb').innerHTML = `<div class="fb bad">${esc(e.message)}</div>`; const sb = $('#sub'); if (sb) sb.disabled = false; return; }
  if (r.unreadable) { S.busy = false; const sb = $('#sub'); if (sb) sb.disabled = false; $('#fb').innerHTML = `<div class="fb bad"><strong>📷 Couldn't read that photo</strong><div class="ex">${esc(r.feedback)}</div></div>`; return; }
  if (r.needsSelfMark) { S.busy = false; $('#ans').disabled = true; $('#sub').remove();
    $('#fb').innerHTML = `<div class="fb neutral"><strong>Model answer</strong><div class="ex">${esc(r.answer)}<br>${esc(r.explain || '')}</div><p class="muted">Compare with your answer. Did you get it right?</p>
      <div class="row"><button id="yes">✅ I got it</button><button class="secondary" id="no">❌ Not quite</button></div></div>`;
    $('#yes').onclick = () => submit(q, given, null, true); $('#no').onclick = () => submit(q, given, null, false); return; }
  S.answered++; S.results[S.i] = r.correct; if (r.correct) S.right++;
  if (q.type === 'mc') app.querySelectorAll('.opt').forEach(b => { b.disabled = true; if (b.dataset.o === r.answer) b.classList.add('right'); else if (b === btn) b.classList.add('wrong'); });
  else { const a = $('#ans'); if (a) a.disabled = true; const sb = $('#sub'); if (sb) sb.remove(); }
  const last = S.i + 1 >= S.qs.length, quick = S.mode === 'blitz' && r.correct;
  $('#fb').innerHTML = `<div class="fb ${r.correct ? 'good' : 'bad'}"><strong>${r.correct ? ['✅ Correct!', '🌟 Nice one!', '💪 Spot on!'][S.i % 3] : '❌ Not quite'}</strong>${r.correct ? '' : `<div class="ex">Answer: <b>${esc(r.answer)}</b></div>`}${r.explain ? `<div class="ex">${esc(r.explain)}</div>` : ''}</div>
    <button id="next" class="block">${last ? 'Finish' : 'Next'}</button>`;
  const next = () => { if (!S || S.qs[S.i] !== q) return; S.i++; S.i < S.qs.length ? question() : finish(); };
  $('#next').onclick = next; if (quick) setTimeout(next, 700); $('#next').focus();
}
async function finish(timeUp) {
  const s = S; clearInterval(s.tick); let m = null;
  if (s.mockId) { try { m = await api(`/mocks/${s.mockId}/finish`, { body: {} }); } catch {} }
  const secs = Math.round((Date.now() - s.t0) / 1000), st = (await api(`/children/${child.id}/stats`).catch(() => ({}))).stats || {};
  S = null; setNav('home');
  const score = m ? m.score : s.right, total = m ? m.total : s.qs.length, pct = Math.round(score / total * 100);
  const msg = pct >= 90 ? ['🏆', 'Outstanding!'] : pct >= 70 ? ['🎉', 'Great work!'] : pct >= 50 ? ['👍', 'Good effort — keep practising!'] : ['💪', "Every question makes you stronger!"];
  app.innerHTML = `<div class="card result"><div class="big-emoji">${timeUp ? '⏰' : msg[0]}</div><h2>${timeUp ? "Time's up!" : msg[1]}</h2>
    ${ring(score, total, `${score}/${total}`, pct >= 70 ? 'var(--good)' : 'var(--sun)', 'var(--line)', 130, 12)}
    <div class="stats" style="grid-template-columns:repeat(3,1fr)">${stat('⏱️', fmt(secs), 'time taken')}${stat('🔥', st.streak ?? '-', 'day streak')}${stat('📅', st.today ?? '-', 'done today')}</div>
    ${s.mode === 'mock' ? `<p class="muted">Mock tests are saved so your parents can see your improvement.</p>` : ''}
    <button id="again" class="block">Practise more</button><button class="secondary block" id="prog">See my progress</button></div>`;
  $('#again').onclick = home; $('#prog').onclick = mine;
}

// ---------- dashboards ----------
const chart = last14 => { const mx = Math.max(1, ...last14.map(d => d.n));
  return `<div class="chart">${last14.map(d => `<div class="b" title="${d.day}: ${d.n} questions">${d.n || ''}<i class="${d.n ? '' : 'zero'}" style="height:${d.n ? Math.max(6, d.n / mx * 100) : 3}%"></i></div>`).join('')}</div><div class="axis">${last14.map(d => `<span>${+d.day.slice(8)}</span>`).join('')}</div>`; };
const topicList = topics => topics.length ? `<div class="tl">${topics.map(t => { const a = Math.round(t.right / t.n * 100);
  return `<div class="t"><b>${esc(t.subject)}: ${esc(t.topic)}</b><span>${accPill(a)}</span><div class="meter"><i style="width:${a}%;background:${accColor(a)}"></i></div><span class="muted">${t.n} answered${a < 55 && t.n >= 3 ? ' · needs more practice' : ''}</span></div>`; }).join('')}</div>` : '<div class="empty"><div class="em">🌱</div>No practice yet — topics appear here.</div>';
const mockTable = mocks => mocks.length ? `<table><tr><th>Date</th><th>Score</th><th>Time</th></tr>${mocks.slice().reverse().map(m => `<tr><td>${new Date(m.finished).toLocaleDateString()}</td><td>${m.score}/${m.total} ${accPill(Math.round(m.score / m.total * 100))}</td><td>${fmt(Math.round((m.finished - m.started) / 1000))} / ${fmt(m.limit_s)}</td></tr>`).join('')}</table>` : '<div class="empty"><div class="em">⏱️</div>No mock tests yet.</div>';

async function mine() {
  setNav('mine'); if (!child) return;
  const { stats: s } = await api(`/children/${child.id}/stats`);
  app.innerHTML = `<div class="card hello"><div class="avatar">${avatar(child)}</div><div><h2>${esc(child.name)}'s progress</h2><p>${s.total} questions answered so far</p></div></div>
    <div class="card"><div class="stats">${stat('✅', s.total, 'questions done')}${stat('📅', s.today, 'today')}${stat('🔥', s.streak, 'day streak')}${stat('⭐', s.xp, 'XP')}</div>
    <h3>Last 14 days</h3>${chart(s.last14)}</div><div class="card"><h3 style="margin-top:0">How I'm doing by topic</h3>${topicList(s.topics)}</div>`;
}
async function parentView() {
  setNav('parent');
  const all = await Promise.all(ME.children.map(c => api(`/children/${c.id}/stats`)));
  app.innerHTML = (all.map(({ child: c, stats: s }) => `<div class="card"><div style="display:flex;align-items:center;gap:12px"><div class="avatar" style="background:var(--brand-l)">${avatar(c)}</div><div><h2 style="margin:0">${esc(c.name)}</h2><span class="muted">${esc(c.year)}</span></div></div>
    <div class="stats">${stat('📆', s.week, 'this week')}${stat('✅', s.total, 'all-time')}${stat('🎯', s.accuracy + '%', 'accuracy')}${stat('⏱️', (s.avgSecs || '-') + 's', 'avg / question')}${stat('🗓️', s.activeDays, 'days practised')}${stat('🔥', s.streak, 'day streak')}</div>
    <h3>Daily activity (14 days)</h3>${chart(s.last14)}<h3>Mock tests</h3>${mockTable(s.mocks)}<h3>Topic strengths</h3>${topicList(s.topics)}</div>`).join('') || '<div class="card empty">No children yet.</div>') +
    `<p class="muted" style="text-align:center">Account: ${esc(ME.user.name)} · ${ME.user.paidUntil ? 'Paid until ' + esc(ME.user.paidUntil) : 'Free trial'}</p>`;
}

// ---------- admin ----------
async function admin() {
  setNav('admin'); const { families, signupCode } = await api('/admin/families');
  app.innerHTML = `<div class="card"><h2>Families</h2><p class="muted">Signup code to give new families: <span class="pill brand">${esc(signupCode)}</span></p>
  ${families.length ? `<table><tr><th>Family</th><th>Children (week / total)</th><th>Access</th><th></th></tr>${families.map(f => `<tr>
    <td><b>${esc(f.name)}</b><br><span class="muted">${esc(f.email)}</span></td>
    <td>${f.children.map(c => `${esc(c.name)} (${esc(c.year)}): ${c.week} / ${c.total}`).join('<br>') || '—'}</td>
    <td>${f.paid ? '<span class="pill good">active</span>' : '<span class="pill bad">expired</span>'}<br><span class="muted">${esc(f.paid_until || 'trial')}</span></td>
    <td><button class="small" data-w="4" data-u="${f.id}">+4 wks</button> <button class="small secondary" data-w="10" data-u="${f.id}">+10 wks</button></td></tr>`).join('')}</table>` : '<div class="empty"><div class="em">👪</div>No families yet.</div>'}</div>`;
  app.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => { await api('/admin/paid', { body: { userId: +b.dataset.u, addWeeks: +b.dataset.w } }); admin(); });
}

// ---------- booklet import (admin) ----------
async function importScreen() {
  setNav('import');
  const { drafts, years } = await api('/admin/drafts');
  app.innerHTML = `<div class="card"><h2>Import a booklet</h2>
    <p class="muted">Drop a PDF (or page photos). AI extracts the questions into a review list below — nothing goes live until you approve it.</p>
    <div class="row"><div><label>Year group</label><input type="text" id="iy" list="yl" value="${esc(LS.get('iy') || years[0] || 'Year 5')}"><datalist id="yl">${years.map(y => `<option>${y}</option>`).join('')}</datalist></div>
    <div><label>Subject (optional)</label><input type="text" id="is" placeholder="Maths, English… or let AI decide" value="${esc(LS.get('is') || '')}"></div></div>
    <div id="drop" class="drop"><div style="font-size:2rem">📄</div>Drag &amp; drop a booklet here, or click to choose<br><span class="muted">PDF, PNG or JPEG · up to 30 MB · long booklets: upload in parts</span></div>
    <input type="file" id="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple hidden><div id="st" class="muted" style="margin-top:8px"></div></div>
    <div id="queue"></div>`;
  const drop = $('#drop'), st = $('#st');
  const upload = async files => {
    const year = $('#iy').value.trim(), subject = $('#is').value.trim(); LS.set('iy', year); LS.set('is', subject);
    if (!year) return (st.textContent = 'Enter a year group first.');
    for (const f of files) {
      st.textContent = `⏳ Reading ${f.name}… this can take a minute or two.`;
      try { const r = await fetch(`/api/admin/import?year=${encodeURIComponent(year)}&subject=${encodeURIComponent(subject)}`, { method: 'POST', headers: { 'content-type': f.type }, body: f });
        const j = await r.json(); if (!r.ok) throw new Error(j.error); st.textContent = `✅ ${f.name}: ${j.added} questions found.`; }
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
  const el = $('#queue'); if (!drafts.length) { el.innerHTML = '<div class="card empty"><div class="em">✨</div>No questions waiting for review.</div>'; return; }
  const patch = (id, body) => api('/admin/drafts/' + id, { method: 'PATCH', body });
  el.innerHTML = `<div class="card"><h2>Review (${drafts.length})</h2><p class="muted">Check each question and answer. ⚠️ flags need your eye. Approved questions appear for students straight away.</p>
    <button id="all">Approve all (${drafts.length}) — incomplete ones are skipped</button></div>` + drafts.map(d => `<div class="card" data-id="${d.id}">
    <div>${d.answerFromBooklet ? '' : '<span class="pill warn">⚠️ answer written by AI — check it</span> '}${d.hasFigure ? '<span class="pill warn">⚠️ has a diagram/figure</span> ' : ''}${d.page ? `<span class="pill">page ${d.page}</span>` : ''}</div>
    <div class="row"><div><label>Subject</label><input type="text" data-k="subject" value="${esc(d.subject)}"></div><div><label>Topic</label><input type="text" data-k="topic" value="${esc(d.topic)}"></div>
    <div><label>Type</label><select data-k="type">${['mc', 'short', 'written'].map(t => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <label>Question</label><textarea data-k="q" rows="3">${esc(d.q)}</textarea>
    <label>Options (one per line, multiple choice only)</label><textarea data-k="options" rows="3">${esc(d.options.join('\n'))}</textarea>
    <label>Correct answer${d.type === 'mc' ? ' (must match an option exactly)' : ' (separate accepted alternatives with |)'}</label><input type="text" data-k="answer" value="${esc(d.answer.join(' | '))}">
    <label>Explanation</label><input type="text" data-k="explain" value="${esc(d.explain)}">
    <div class="err"></div><button class="small" data-a="approve">✅ Approve</button> <button class="small secondary" data-a="reject">🗑 Reject</button></div>`).join('');
  el.querySelectorAll('[data-k]').forEach(i => i.onchange = () => { const id = i.closest('[data-id]').dataset.id, k = i.dataset.k, v = i.value;
    patch(id, { [k]: k === 'options' ? v.split('\n') : k === 'answer' ? v.split('|') : v }); });
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { const c = b.closest('[data-id]'), id = c.dataset.id;
    document.activeElement && document.activeElement.blur(); await new Promise(r => setTimeout(r, 150));
    try { await api(`/admin/drafts/${id}/${b.dataset.a}`, { body: {} }); c.remove(); } catch (e) { c.querySelector('.err').textContent = e.message; } });
  $('#all').onclick = async () => { const r = await api('/admin/drafts/approve-all', { body: {} }); alert(`Approved ${r.approved}.` + (r.skipped ? ` ${r.skipped} skipped — fix their answers/options first.` : '')); importScreen(); };
}
boot();
})();
