// Usage: BASE=http://localhost:3100 RATE_LIMIT=off (start the server with it too) node tools/loadtest.js
// Load test: N families, login storm, concurrent students, dashboards, admin list.
const B = process.env.BASE || 'http://localhost:3100', N = +process.env.N || 300, STUDENTS = +process.env.STUDENTS || 150, ROUNDS = +process.env.ROUNDS || 30;
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const stat = (name, lat, errs, secs) => console.log(`${name.padEnd(34)} n=${String(lat.length).padStart(5)}  p50=${pct(lat, .5).toFixed(0).padStart(5)}ms  p95=${pct(lat, .95).toFixed(0).padStart(5)}ms  max=${Math.max(0, ...lat).toFixed(0).padStart(5)}ms  errors=${errs}${secs ? `  ${(lat.length / secs).toFixed(0)} req/s` : ''}`);
async function call(path, { method = 'GET', body, cookie } = {}) {
  const t = performance.now(); let r, j = {};
  try { r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); j = await r.json().catch(() => ({})); }
  catch (e) { return { ok: false, ms: performance.now() - t, status: 0, j }; }
  return { ok: r.ok, status: r.status, ms: performance.now() - t, j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function pool(items, conc, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
(async () => {
  const fams = Array.from({ length: N }, (_, i) => ({ email: `load${i}@t.test`, pw: 'password-' + i }));
  // A: sign up N families (20 at a time) and add a child
  let lat = [], errs = 0, t0 = performance.now();
  await pool(fams, 20, async f => { const r = await call('/api/signup', { method: 'POST', body: { name: 'Fam', email: f.email, password: f.pw, code: 'UPLUS' } }); lat.push(r.ms); if (!r.ok) { errs++; return; }
    f.cookie = r.cookie; const c = await call('/api/children', { method: 'POST', cookie: f.cookie, body: { name: 'Kid', year: 'Year 5' } }); f.child = c.j.id; });
  stat(`signup x${N} (20 at a time)`, lat, errs, (performance.now() - t0) / 1000);
  // B: login storm - everyone logs in at the same moment, while a logged-in user keeps polling /api/me
  lat = []; errs = 0; const probe = []; let stop = false;
  const prober = (async () => { while (!stop) { const r = await call('/api/me', { cookie: fams[0].cookie }); probe.push(r.ms); await new Promise(r => setTimeout(r, 25)); } })();
  t0 = performance.now(); const storm = fams.slice(0, Math.min(N, 200));
  await pool(storm, storm.length, async f => { const r = await call('/api/login', { method: 'POST', body: { email: f.email, password: f.pw } }); lat.push(r.ms); if (!r.ok) errs++; else f.cookie = r.cookie; });
  stop = true; await prober; stat(`login storm (${storm.length} simultaneous)`, lat, errs); stat('  /api/me latency DURING the storm', probe, 0);
  // C: concurrent students: fetch questions, answer ROUNDS of them back to back
  lat = []; errs = 0; const qlat = []; const students = fams.slice(0, STUDENTS); t0 = performance.now();
  await pool(students, students.length, async f => { for (let r = 0; r < ROUNDS / 10; r++) { const q = await call(`/api/questions?childId=${f.child}&year=Year%205&n=10`, { cookie: f.cookie }); qlat.push(q.ms); if (!q.ok) { errs++; continue; }
    for (const x of q.j.questions) { const a = await call('/api/answer', { method: 'POST', cookie: f.cookie, body: { childId: f.child, qid: x.id, given: x.options ? x.options[0] : '1', ms: 5000, mode: 'practice' } }); lat.push(a.ms); if (!a.ok && a.status !== 200) errs++; } } });
  const secs = (performance.now() - t0) / 1000; stat(`answers (${STUDENTS} concurrent students)`, lat, errs, secs); stat('question fetches', qlat, 0);
  // D: dashboards
  lat = []; errs = 0; t0 = performance.now();
  await pool(students.slice(0, 100), 100, async f => { const r = await call(`/api/children/${f.child}/stats`, { cookie: f.cookie }); lat.push(r.ms); if (!r.ok) errs++; });
  stat('parent dashboard x100 simultaneous', lat, errs);
  const a = await call('/api/login', { method: 'POST', body: { email: 'admin@uplus.test', password: 'admin123' } });
  const fl = await call('/api/admin/families', { cookie: a.cookie }); console.log(`admin families list (${(fl.j.families || []).length} families)`.padEnd(34), `${fl.ms.toFixed(0)}ms`, fl.ok ? '' : 'ERROR');
  const total = await call('/api/me', { cookie: fams[0].cookie }); process.exit(0);
})();
