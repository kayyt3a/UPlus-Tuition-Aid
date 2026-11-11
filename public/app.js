(() => {
const $ = s => document.querySelector(s), app = $('#app'), nav = $('#nav');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let ME = null, child = null, S = null; // S = active session
const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

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
  if (!ME) { nav.innerHTML = ''; return; }
  const u = ME.user, items = u.role === 'admin' ? [['admin', 'Families']] : [['home', '🏠 Practice'], ['mine', '📈 My progress'], ['parent', '👨‍👩‍👧 Parent dashboard']];
  nav.innerHTML = items.map(([k, l]) => `<button data-nav="${k}" class="${k === active ? 'on' : ''}">${l}</button>`).join('') + `<button data-nav="out">Log out</button>`;
}
nav.onclick = e => { const k = e.target.dataset.nav; if (!k) return; S = null;
  ({ home, mine, parent: parentView, admin, out: async () => { await api('/logout', { body: {} }); ME = null; authScreen(); } })[k](); };

// ---------- auth ----------
function authScreen(mode = 'login', err = '') {
  setNav();
  app.innerHTML = `<div class="card"><h2>Welcome to UPlus Practice</h2>
  <p class="muted">Extra practice for UPlus Education families.</p>
  <div class="tabs"><button class="${mode === 'login' ? '' : 'secondary'}" data-m="login">Log in</button><button class="${mode === 'signup' ? '' : 'secondary'}" data-m="signup">New family</button></div>
  <form id="f">${mode === 'signup' ? `<label>Parent name</label><input type="text" name="name" required>` : ''}
  <label>Email</label><input type="email" name="email" required autocomplete="username">
  <label>Password${mode === 'signup' ? ' (8+ characters)' : ''}</label><input type="password" name="password" required autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">
  ${mode === 'signup' ? `<label>Family code (from UPlus)</label><input type="text" name="code" required>` : ''}
  <div class="err">${esc(err)}</div><button>${mode === 'signup' ? 'Create account' : 'Log in'}</button></form>
  ${mode === 'login' ? `<p class="muted">Demo: parent@uplus.test / parent123</p>` : ''}</div>`;
  app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => authScreen(b.dataset.m));
  $('#f').onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
    try { await api(mode === 'signup' ? '/signup' : '/login', { body }); boot(); } catch (x) { authScreen(mode, x.message); } };
}

function addChild(first) {
  setNav('home');
  app.innerHTML = `<div class="card"><h2>${first ? 'Add your first child' : 'Add a child'}</h2>
  <form id="f"><label>First name</label><input type="text" name="name" required maxlength="40">
  <label>Year group</label><select name="year">${ME.years.map(y => `<option>${y}</option>`).join('')}</select>
  <div class="err" id="e"></div><button>Add</button>${first ? '' : '<button type="button" class="secondary" id="cancel">Cancel</button>'}</form></div>`;
  if (!first) $('#cancel').onclick = home;
  $('#f').onsubmit = async e => { e.preventDefault(); try { const r = await api('/children', { body: Object.fromEntries(new FormData(e.target)) }); LS.set('child', r.id); await boot(); } catch (x) { $('#e').textContent = x.message; } };
}

// ---------- practice home ----------
function home() {
  setNav('home'); if (!ME.user.paid) return locked();
  const cat = ME.catalog[child.year] || {}, subs = Object.keys(cat);
  app.innerHTML = `<div class="card"><div class="row"><div><label>Who's practising?</label><select id="kid">${ME.children.map(c => `<option value="${c.id}" ${c.id === child.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div><label>Year group</label><select id="yr">${ME.years.map(y => `<option ${y === child.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
  <button class="secondary small" id="addkid">+ Add another child</button></div>
  <div id="today"></div>
  <div class="card"><h2>Pick your practice</h2>
    <div class="row"><div><label>Subject</label><select id="sub">${subs.map(s => `<option>${s}</option>`).join('')}</select></div>
    <div><label>Topic</label><select id="top"></select></div></div>
    <button id="go">Practice 10 questions</button>
    <button id="blitz">⚡ Flashcard blitz (25)</button>
    <button class="secondary" id="mock">⏱️ Timed mock test (15 questions)</button>
    <button class="secondary" id="holiday">🏖️ Holiday challenge (mixed, 20)</button></div>`;
  const sub = $('#sub'), top = $('#top');
  const fillTop = () => top.innerHTML = '<option value="">All topics</option>' + ((cat[sub.value] || []).map(t => `<option>${t}</option>`).join('')); fillTop(); sub.onchange = fillTop;
  $('#kid').onchange = e => { child = ME.children.find(c => c.id === +e.target.value); LS.set('child', child.id); home(); };
  $('#yr').onchange = async e => { await api('/children/' + child.id, { method: 'PATCH', body: { year: e.target.value } }); child.year = e.target.value; home(); };
  $('#addkid').onclick = () => addChild(false);
  const q = (extra, mode, n) => startSession(`/questions?childId=${child.id}&n=${n}&year=${encodeURIComponent(child.year)}${extra}`, mode);
  $('#go').onclick = () => q(`&subject=${encodeURIComponent(sub.value)}&topic=${encodeURIComponent(top.value)}`, 'practice', 10);
  $('#blitz').onclick = () => q(`&subject=${encodeURIComponent(sub.value)}&topic=${encodeURIComponent(top.value)}`, 'blitz', 25);
  $('#holiday').onclick = () => q('', 'holiday', 20);
  $('#mock').onclick = async () => { try { const r = await api('/mocks', { body: { childId: child.id, n: 15 } }); begin(r.questions, 'mock', { mockId: r.mockId, limit: r.limitSecs }); } catch (e) { alert(e.message); } };
  api(`/children/${child.id}/stats`).then(r => { const s = r.stats; $('#today').innerHTML = `<div class="card"><div class="stats">
    <div class="stat"><b>${s.today}</b><span>done today</span></div><div class="stat"><b>🔥 ${s.streak}</b><span>day streak</span></div>
    <div class="stat"><b>${s.total}</b><span>all-time questions</span></div><div class="stat"><b>⭐ ${s.xp}</b><span>XP</span></div></div></div>`; }).catch(() => {});
}
function locked() { app.innerHTML = `<div class="card"><h2>Practice is paused</h2><p>Your free trial or subscription has ended. Please contact UPlus Education to renew — your child's progress is saved and will be here when you're back.</p><button class="secondary" id="p">View progress</button></div>`; $('#p').onclick = parentView; }

// ---------- session ----------
async function startSession(path, mode) {
  try { const r = await api(path); if (!r.questions.length) return alert('No questions here yet!'); begin(r.questions, mode, {}); } catch (e) { e.status === 402 ? locked() : alert(e.message); }
}
function begin(qs, mode, extra) {
  S = { qs, mode, i: 0, right: 0, answered: 0, t0: Date.now(), ...extra };
  if (mode === 'mock') { S.deadline = Date.now() + S.limit * 1000; S.tick = setInterval(timerTick, 500); }
  question();
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function timerTick() { if (!S || S.mode !== 'mock') return clearInterval(S && S.tick); const left = Math.ceil((S.deadline - Date.now()) / 1000), el = $('#timer');
  if (el) { el.textContent = fmt(left); el.classList.toggle('low', left < 60); } if (left <= 0) finish(true); }
function question() {
  const q = S.qs[S.i]; S.qStart = Date.now(); S.busy = false;
  const body = q.type === 'mc' ? q.options.map(o => `<button class="opt" data-o="${esc(o)}">${esc(o)}</button>`).join('')
    : q.type === 'written' ? `<textarea id="ans" rows="4" placeholder="Write your answer and working"></textarea><button id="sub">Submit</button>`
    : `<input type="text" id="ans" autocomplete="off" placeholder="Your answer"><button id="sub">Check</button>`;
  app.innerHTML = `<div class="card"><div class="bar"><div style="width:${S.i / S.qs.length * 100}%"></div></div>
    <p class="muted">${S.mode === 'mock' ? `⏱️ <span class="timer" id="timer">${fmt(Math.ceil((S.deadline - Date.now()) / 1000))}</span> · ` : ''}Question ${S.i + 1} of ${S.qs.length} · ${esc(q.subject)} · ${esc(q.topic)}</p>
    <div class="${S.mode === 'blitz' ? 'big' : ''}"><h2>${esc(q.q)}</h2></div>${body}<div id="fb"></div></div>`;
  if (q.type === 'mc') app.querySelectorAll('.opt').forEach(b => b.onclick = () => submit(q, b.dataset.o, b));
  else { const i = $('#ans'); i.focus(); $('#sub').onclick = () => submit(q, i.value); if (q.type !== 'written') i.onkeydown = e => e.key === 'Enter' && submit(q, i.value); }
}
async function submit(q, given, btn, selfCorrect) {
  if (S.busy) return; if (q.type !== 'mc' && selfCorrect === undefined && !String(given).trim()) return; S.busy = true;
  const ms = Date.now() - S.qStart, mode = S.mode === 'mock' ? 'mock' : S.mode;
  if (q.type === 'written' && selfCorrect === undefined) { const sb = $('#sub'); if (sb) sb.disabled = true; $('#fb').innerHTML = '<p class="muted">🤖 Marking…</p>'; }
  let r; try { r = await api('/answer', { body: { childId: child.id, qid: q.id, given, ms, mode, mockId: S.mockId, selfCorrect } }); }
  catch (e) { S.busy = false; if (e.status === 402) return locked(); $('#fb').innerHTML = `<div class="fb bad">${esc(e.message)}</div>`; const sb = $('#sub'); if (sb) sb.disabled = false; return; }
  if (r.needsSelfMark) { S.busy = false; $('#ans').disabled = true; $('#sub').remove();
    $('#fb').innerHTML = `<div class="fb"><b>Model answer:</b> ${esc(r.answer)}<br>${esc(r.explain || '')}<p>Compare with your answer. Did you get it right?</p>
      <button id="yes">✅ I got it</button> <button class="secondary" id="no">❌ Not quite</button></div>`;
    $('#yes').onclick = () => submit(q, given, null, true); $('#no').onclick = () => submit(q, given, null, false); return; }
  S.answered++; if (r.correct) S.right++;
  if (q.type === 'mc') app.querySelectorAll('.opt').forEach(b => { b.disabled = true; if (b.dataset.o === r.answer) b.classList.add('right'); else if (b === btn) b.classList.add('wrong'); });
  else { const a = $('#ans'); if (a) a.disabled = true; const sb = $('#sub'); if (sb) sb.remove(); }
  const last = S.i + 1 >= S.qs.length, quick = S.mode === 'blitz' && r.correct;
  $('#fb').innerHTML = `<div class="fb ${r.correct ? 'good' : 'bad'}">${r.correct ? '✅ Correct!' : `❌ Not quite. Answer: <b>${esc(r.answer)}</b>`}<br>${esc(r.explain)}</div><button id="next">${last ? 'Finish' : 'Next'}</button>`;
  const next = () => { if (!S || S.qs[S.i] !== q) return; S.i++; S.i < S.qs.length ? question() : finish(); };
  $('#next').onclick = next; if (quick) setTimeout(next, 700); $('#next').focus();
}
async function finish(timeUp) {
  const s = S; clearInterval(s.tick); let m = null;
  if (s.mockId) { try { m = await api(`/mocks/${s.mockId}/finish`, { body: {} }); } catch {} }
  const secs = Math.round((Date.now() - s.t0) / 1000), st = (await api(`/children/${child.id}/stats`).catch(() => ({}))).stats || {};
  S = null; setNav('home');
  app.innerHTML = `<div class="card"><h2>${timeUp ? "⏰ Time's up!" : 'Done! 🎉'}</h2>
    <div class="stats"><div class="stat"><b>${m ? m.score : s.right} / ${m ? m.total : s.qs.length}</b><span>correct</span></div><div class="stat"><b>${fmt(secs)}</b><span>time taken</span></div><div class="stat"><b>🔥 ${st.streak ?? '-'}</b><span>day streak</span></div></div>
    ${s.mode === 'mock' ? `<p class="muted">Mock tests are saved so your parents can see your improvement over time.</p>` : ''}
    <button id="again">Practise more</button><button class="secondary" id="prog">See my progress</button></div>`;
  $('#again').onclick = home; $('#prog').onclick = mine;
}

// ---------- dashboards ----------
const chart = last14 => { const mx = Math.max(1, ...last14.map(d => d.n));
  return `<div class="chart">${last14.map(d => `<div class="${d.n ? '' : 'zero'}" style="height:${Math.max(2, d.n / mx * 100)}%" title="${d.day}: ${d.n} questions"></div>`).join('')}</div>
  <div class="axis">${last14.map(d => `<span>${d.day.slice(8)}</span>`).join('')}</div>`; };
const accPill = a => `<span class="pill ${a >= 75 ? 'good' : a >= 55 ? 'warn' : 'bad'}">${a}%</span>`;
function topicTable(topics) { return topics.length ? `<table><tr><th>Topic</th><th>Done</th><th>Accuracy</th></tr>${topics.map(t => { const a = Math.round(t.right / t.n * 100);
  return `<tr><td>${esc(t.subject)}: ${esc(t.topic)}</td><td>${t.n}</td><td>${accPill(a)}${a < 55 && t.n >= 3 ? ' needs work' : ''}</td></tr>`; }).join('')}</table>` : '<p class="muted">No practice yet.</p>'; }
function mockTable(mocks) { return mocks.length ? `<table><tr><th>Date</th><th>Score</th><th>Time</th></tr>${mocks.slice().reverse().map(m => `<tr><td>${new Date(m.finished).toLocaleDateString()}</td><td>${m.score}/${m.total} ${accPill(Math.round(m.score / m.total * 100))}</td><td>${fmt(Math.round((m.finished - m.started) / 1000))} / ${fmt(m.limit_s)}</td></tr>`).join('')}</table>` : '<p class="muted">No mock tests yet.</p>'; }

async function mine() {
  setNav('mine'); if (!child) return;
  const { stats: s } = await api(`/children/${child.id}/stats`);
  app.innerHTML = `<div class="card"><h2>${esc(child.name)}'s progress</h2>
    <div class="stats"><div class="stat"><b>${s.total}</b><span>questions done</span></div><div class="stat"><b>${s.today}</b><span>today</span></div><div class="stat"><b>🔥 ${s.streak}</b><span>day streak</span></div><div class="stat"><b>⭐ ${s.xp}</b><span>XP</span></div></div>
    <h3>Last 14 days</h3>${chart(s.last14)}</div>
    <div class="card"><h3>Topics</h3>${topicTable(s.topics)}</div>`;
}
async function parentView() {
  setNav('parent');
  const all = await Promise.all(ME.children.map(c => api(`/children/${c.id}/stats`)));
  app.innerHTML = (all.map(({ child: c, stats: s }) => `<div class="card"><h2>${esc(c.name)} <span class="muted">· ${esc(c.year)}</span></h2>
    <div class="stats"><div class="stat"><b>${s.week}</b><span>this week</span></div><div class="stat"><b>${s.total}</b><span>all-time</span></div><div class="stat"><b>${s.accuracy}%</b><span>accuracy</span></div>
    <div class="stat"><b>${s.avgSecs || '-'}s</b><span>avg per question</span></div><div class="stat"><b>${s.activeDays}</b><span>days practised</span></div><div class="stat"><b>🔥 ${s.streak}</b><span>day streak</span></div></div>
    <h3>Daily activity (14 days)</h3>${chart(s.last14)}
    <h3>Mock tests</h3>${mockTable(s.mocks)}
    <h3>Topic strengths</h3>${topicTable(s.topics)}</div>`).join('') || '<div class="card">No children yet.</div>') +
    `<div class="card"><p class="muted">Account: ${esc(ME.user.name)} · ${ME.user.paidUntil ? 'Paid until ' + esc(ME.user.paidUntil) : 'Free trial'}</p></div>`;
}

// ---------- admin ----------
async function admin() {
  setNav('admin'); const { families, signupCode } = await api('/admin/families');
  app.innerHTML = `<div class="card"><h2>Families</h2><p class="muted">Signup code to give new families: <b>${esc(signupCode)}</b></p>
  ${families.length ? `<table><tr><th>Family</th><th>Children (this week / total)</th><th>Paid until</th><th></th></tr>${families.map(f => `<tr>
    <td>${esc(f.name)}<br><span class="muted">${esc(f.email)}</span></td>
    <td>${f.children.map(c => `${esc(c.name)} (${esc(c.year)}): ${c.week} / ${c.total}`).join('<br>') || '—'}</td>
    <td>${f.paid ? '<span class="pill good">active</span>' : '<span class="pill bad">expired</span>'}<br>${esc(f.paid_until || 'trial')}</td>
    <td><button class="small" data-w="4" data-u="${f.id}">+4 wks</button><button class="small secondary" data-w="10" data-u="${f.id}">+10 wks</button></td></tr>`).join('')}</table>` : '<p class="muted">No families yet.</p>'}</div>`;
  app.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => { await api('/admin/paid', { body: { userId: +b.dataset.u, addWeeks: +b.dataset.w } }); admin(); });
}
boot();
})();
