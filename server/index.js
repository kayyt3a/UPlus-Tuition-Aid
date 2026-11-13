const http = require('http'), fs = require('fs'), path = require('path');
const db = require('./db'), auth = require('./auth'), mark = require('./mark'), stats = require('./stats');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'questions.json'), 'utf8'));
try { db.exec('ALTER TABLE questions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0'); } catch {}
db.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)');
if (!db.prepare("SELECT v FROM meta WHERE k='seeded'").get()) { // one-off: load the sample questions so the app is not empty on first run
  const ins = db.prepare('INSERT OR IGNORE INTO questions(id,data) VALUES(?,?)'); BASE.questions.forEach(q => ins.run(q.id, JSON.stringify(q)));
  db.prepare("INSERT INTO meta VALUES('seeded','1')").run(); }
let DATA, QMAP;
function loadQuestions() {
  const rows = db.prepare('SELECT data, archived FROM questions').all().map(r => ({ q: JSON.parse(r.data), arch: r.archived }));
  const active = rows.filter(r => !r.arch).map(r => r.q);
  DATA = { yearGroups: [...new Set([...BASE.yearGroups, ...active.map(q => q.year)])].sort(), questions: active };
  QMAP = Object.fromEntries(rows.map(r => [r.q.id, r.q])); // includes removed questions so old results still map to a topic
}
loadQuestions();
const crypto = require('crypto');
const extract = require('./extract');
const rawBody = (req, max) => new Promise((ok, no) => { const ch = []; let n = 0; req.on('data', c => { n += c.length; if (n > max) { no(new Error('File too large')); req.destroy(); } else ch.push(c); }); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', no); });
const PROD = process.env.NODE_ENV === 'production', SECURE = PROD || process.env.COOKIE_SECURE === '1';
if (PROD && (!process.env.SIGNUP_CODE || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) { console.error('Refusing to start in production: set SIGNUP_CODE, ADMIN_EMAIL and ADMIN_PASSWORD.'); process.exit(1); }
const SIGNUP_CODE = process.env.SIGNUP_CODE || 'UPLUS';
const zlib = require('zlib');
// Small in-memory rate limiter (per process; fine for a single instance).
const hits = new Map();
function limited(key, max, windowMs) { if (process.env.RATE_LIMIT === 'off') return false; const now = Date.now(); let h = hits.get(key); if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); } return ++h.n > max; }
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60000).unref();
const clientIp = req => process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress : req.socket.remoteAddress; // behind one proxy, the last entry is the one the proxy added
const cookieFlags = (maxAge) => `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;
const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';
const PUB = path.join(__dirname, '..', 'public');
const today = () => new Date().toISOString().slice(0, 10);
const strip = ({ answer, explain, ...q }) => q;

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c) return;
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) { // real deployment: create only the admin you specify, no demo data
    if (process.env.ADMIN_PASSWORD.length < 10) { console.error('ADMIN_PASSWORD must be at least 10 characters.'); process.exit(1); }
    auth.createUserSync(process.env.ADMIN_EMAIL, 'UPlus Admin', process.env.ADMIN_PASSWORD, 'admin'); console.log('Created admin account for ' + process.env.ADMIN_EMAIL); return; }
  auth.createUserSync('admin@uplus.test', 'UPlus Admin', 'admin123', 'admin');
  const pid = auth.createUserSync('parent@uplus.test', 'Demo Parent', 'parent123', 'parent', new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10));
  const cid = db.prepare('INSERT INTO children(user_id,name,year) VALUES(?,?,?)').run(pid, 'Mia', 'Year 5').lastInsertRowid;
  const qs = DATA.questions.filter(q => q.year === 'Year 5' || q.year === 'Year 4');
  const ins = db.prepare('INSERT INTO attempts(child_id,qid,correct,ms,mode,day,ts) VALUES(?,?,?,?,?,?,?)');
  for (let d = 9; d >= 0; d--) { if (d === 4 || d === 5) continue; const ts = Date.now() - d * 864e5;
    for (let k = 0; k < 6 + (d % 5) * 3; k++) { const q = qs[(k + d) % qs.length]; ins.run(cid, q.id, Math.random() < 0.55 + (9 - d) * 0.03 ? 1 : 0, 6000 + Math.random() * 25000 | 0, 'practice', new Date(ts).toISOString().slice(0, 10), ts + k); } }
  console.log('Seeded demo data: admin@uplus.test/admin123, parent@uplus.test/parent123');
}
seed();
const DEMO = !!db.prepare("SELECT 1 FROM users WHERE email='parent@uplus.test'").get(); // shows the demo-login hint only on demo databases

const json = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
const body = (req, max = 1e5) => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > max) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); req.on('close', () => r({})); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function childFor(user, id) {
  const c = db.prepare('SELECT * FROM children WHERE id=?').get(id);
  return c && (c.user_id === user.id || user.role === 'admin') ? c : null;
}
function pickQuestions(child, { year, subject, topic, n }) {
  let pool = DATA.questions.filter(q => (!year || q.year === year) && (!subject || q.subject === subject) && (!topic || q.topic === topic));
  const hist = {}; db.prepare('SELECT qid, SUM(correct) r, COUNT(*)-SUM(correct) w FROM attempts WHERE child_id=? GROUP BY qid').all(child.id).forEach(h => hist[h.qid] = h);
  const w = q => { const h = hist[q.id]; if (!h) return 3; return h.w / (h.r + h.w) > .5 ? 4 : h.r - h.w >= 2 ? .5 : 1.5; };
  return pool.map(q => ({ q, k: Math.random() ** (1 / w(q)) })).sort((a, b) => b.k - a.k).slice(0, n).map(x => x.q);
}

async function api(req, res, url) {
  const p = url.pathname, m = req.method, user = auth.userFromCookie(req.headers.cookie);
  const b = (m === 'POST' || m === 'PATCH') && p !== '/api/admin/import' ? await body(req, p === '/api/answer' ? 7e6 : 1e5) : {};
  if (p === '/api/config') return json(res, 200, { demo: DEMO });
  if (p === '/api/signup' && m === 'POST') {
    if (limited('su:' + clientIp(req), 15, 3600e3)) return json(res, 429, { error: TOO_MANY });
    if (String(b.code || '').trim().toUpperCase() !== SIGNUP_CODE.toUpperCase()) return json(res, 403, { error: 'Invalid family code. Ask UPlus for your code.' });
    if (!/^\S+@\S+\.\S+$/.test(b.email || '') || (b.password || '').length < 8 || !(b.name || '').trim()) return json(res, 400, { error: 'Enter your name, a valid email and a password of 8+ characters.' });
    try { const id = await auth.createUser(b.email, b.name, b.password); return json(res, 200, { ok: 1 }, { 'set-cookie': `sid=${auth.newSession(id)}; ${cookieFlags(2592000)}` }); }
    catch { return json(res, 409, { error: 'That email already has an account.' }); }
  }
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (limited('lg:' + ip, 60, 600e3) || limited('lge:' + String(b.email || '').toLowerCase().slice(0, 80), 10, 600e3)) return json(res, 429, { error: TOO_MANY });
    const u = await auth.checkLogin(b.email, b.password || '');
    return u ? json(res, 200, { ok: 1 }, { 'set-cookie': `sid=${auth.newSession(u.id)}; ${cookieFlags(2592000)}` }) : json(res, 401, { error: 'Wrong email or password.' });
  }
  if (p === '/api/logout') { auth.endSession(req.headers.cookie); return json(res, 200, { ok: 1 }, { 'set-cookie': `sid=; ${cookieFlags(0)}` }); }
  if (!user) return json(res, 401, { error: 'Please log in.' });

  if (p === '/api/me') {
    const children = db.prepare(user.role === 'admin' ? 'SELECT * FROM children WHERE 0' : 'SELECT id,name,year FROM children WHERE user_id=?').all(...(user.role === 'admin' ? [] : [user.id]));
    const cat = {}; DATA.questions.forEach(q => { const y = cat[q.year] ||= {}; (y[q.subject] ||= new Set()).add(q.topic); });
    Object.values(cat).forEach(y => Object.keys(y).forEach(s => y[s] = [...y[s]]));
    return json(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role, paidUntil: user.paid_until, paid: !!auth.isPaid(user) }, children, years: DATA.yearGroups, catalog: cat });
  }
  if (p === '/api/children' && m === 'POST') {
    if (!(b.name || '').trim() || !DATA.yearGroups.includes(b.year)) return json(res, 400, { error: 'Enter a name and year group.' });
    const id = db.prepare('INSERT INTO children(user_id,name,year) VALUES(?,?,?)').run(user.id, b.name.trim().slice(0, 40), b.year).lastInsertRowid;
    return json(res, 200, { id });
  }
  const cm = /^\/api\/children\/(\d+)(?:\/(stats))?$/.exec(p);
  if (cm) {
    const c = childFor(user, +cm[1]); if (!c) return json(res, 404, { error: 'Not found' });
    if (m === 'PATCH') { if (DATA.yearGroups.includes(b.year)) db.prepare('UPDATE children SET year=? WHERE id=?').run(b.year, c.id); return json(res, 200, { ok: 1 }); }
    return json(res, 200, { child: { id: c.id, name: c.name, year: c.year }, stats: stats(c.id, QMAP) });
  }

  if (p.startsWith('/api/admin/')) {
    if (user.role !== 'admin') return json(res, 403, { error: 'Admins only' });
    if (p === '/api/admin/families') {
      const weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), agg = {};
      db.prepare('SELECT child_id, COUNT(*) n, SUM(day >= ?) w, MAX(day) last FROM attempts GROUP BY child_id').all(weekAgo).forEach(r => agg[r.child_id] = r);
      const kids = {}; db.prepare('SELECT id,user_id,name,year FROM children').all().forEach(c => (kids[c.user_id] ||= []).push({ id: c.id, name: c.name, year: c.year, total: (agg[c.id] || {}).n || 0, week: (agg[c.id] || {}).w || 0, last: (agg[c.id] || {}).last || null }));
      const fams = db.prepare("SELECT id,name,email,paid_until,created FROM users WHERE role='parent' ORDER BY created DESC").all().map(f => ({ ...f, paid: !!auth.isPaid({ ...f, role: 'parent' }), children: kids[f.id] || [] }));
      return json(res, 200, { families: fams, signupCode: SIGNUP_CODE });
    }
    if (p === '/api/admin/paid' && m === 'POST') {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(b.userId); if (!u) return json(res, 404, { error: 'No such family' });
      let until = b.until; if (b.addWeeks) { const base = u.paid_until && u.paid_until > today() ? new Date(u.paid_until) : new Date(); until = new Date(base.getTime() + b.addWeeks * 7 * 864e5).toISOString().slice(0, 10); }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '')) return json(res, 400, { error: 'Bad date' });
      db.prepare('UPDATE users SET paid_until=? WHERE id=?').run(until, u.id); return json(res, 200, { paidUntil: until });
    }
    if (p === '/api/admin/import' && m === 'POST') {
      const mime = (req.headers['content-type'] || '').split(';')[0], year = url.searchParams.get('year') || '', subject = url.searchParams.get('subject') || '';
      if (!/^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(mime)) return json(res, 400, { error: 'Upload a PDF or a PNG/JPEG image.' });
      if (!year) return json(res, 400, { error: 'Choose a year group first.' });
      let buf; try { buf = await rawBody(req, 30 * 1024 * 1024); } catch (e) { return json(res, 413, { error: 'File too large (max 30 MB). Split the booklet into smaller parts.' }); }
      try {
        const items = await extract.extract({ buffer: buf, mime, year, subject }), batch = 'b' + Date.now(), ins = db.prepare('INSERT INTO drafts(batch,data,created) VALUES(?,?,?)');
        items.forEach((x, i) => ins.run(batch, JSON.stringify(x), Date.now() + i)); return json(res, 200, { added: items.length });
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (p === '/api/admin/drafts' && m === 'GET') return json(res, 200, { drafts: db.prepare("SELECT id,data FROM drafts WHERE status='pending' ORDER BY created").all().map(d => ({ id: d.id, ...JSON.parse(d.data) })), years: DATA.yearGroups });
    const approve = d => { const x = JSON.parse(d.data); const q = { id: 'imp-' + d.id, year: x.year, subject: x.subject, topic: x.topic, type: x.type, q: x.q, answer: x.answer, explain: x.explain };
      if (x.type === 'mc') q.options = x.options; db.prepare('INSERT OR REPLACE INTO questions(id,data,archived) VALUES(?,?,0)').run(q.id, JSON.stringify(q)); db.prepare("UPDATE drafts SET status='approved' WHERE id=?").run(d.id); };
    const valid = x => x.q && x.answer.length && x.answer[0] && (x.type !== 'mc' || (x.options.length >= 2 && x.options.includes(x.answer[0])));
    if (p === '/api/admin/drafts/approve-all' && m === 'POST') {
      let n = 0, skipped = 0; for (const d of db.prepare("SELECT * FROM drafts WHERE status='pending'").all()) { valid(JSON.parse(d.data)) ? (approve(d), n++) : skipped++; }
      loadQuestions(); return json(res, 200, { approved: n, skipped });
    }
    const dm = /^\/api\/admin\/drafts\/(\d+)(?:\/(approve|reject))?$/.exec(p);
    if (dm) {
      const d = db.prepare("SELECT * FROM drafts WHERE id=? AND status='pending'").get(+dm[1]); if (!d) return json(res, 404, { error: 'Not found' });
      const x = JSON.parse(d.data);
      if (m === 'PATCH') { const bb = b; for (const k of ['year', 'subject', 'topic', 'type', 'q', 'explain']) if (typeof bb[k] === 'string') x[k] = bb[k].slice(0, 4000);
        if (Array.isArray(bb.options)) x.options = bb.options.map(o => String(o).trim()).filter(Boolean).slice(0, 8); if (Array.isArray(bb.answer)) x.answer = bb.answer.map(a => String(a).trim()).filter(Boolean);
        db.prepare('UPDATE drafts SET data=? WHERE id=?').run(JSON.stringify(x), d.id); return json(res, 200, { ok: 1 }); }
      if (dm[2] === 'reject') { db.prepare("UPDATE drafts SET status='rejected' WHERE id=?").run(d.id); return json(res, 200, { ok: 1 }); }
      if (dm[2] === 'approve') { if (!valid(x)) return json(res, 400, { error: x.type === 'mc' ? 'Multiple choice needs 2+ options and the answer must match one option exactly.' : 'Add a question and an answer first.' });
        approve(d); loadQuestions(); return json(res, 200, { ok: 1 }); }
    }
    const normQ = x => ({ year: String(x.year || '').trim().slice(0, 30), subject: String(x.subject || '').trim().slice(0, 40), topic: String(x.topic || '').trim().slice(0, 60),
      type: ['mc', 'short', 'written'].includes(x.type) ? x.type : 'short', q: String(x.q || '').trim().slice(0, 4000),
      options: (Array.isArray(x.options) ? x.options : []).map(o => String(o).trim()).filter(Boolean).slice(0, 8),
      answer: (Array.isArray(x.answer) ? x.answer : []).map(a => String(a).trim()).filter(Boolean), explain: String(x.explain || '').trim().slice(0, 1000) });
    const qErr = x => !(x.year && x.subject && x.topic) ? 'Year group, subject and topic are required.' : !valid(x) ? (x.type === 'mc' ? 'Multiple choice needs 2+ options and the answer must match one option exactly.' : 'Add a question and an answer first.') : null;
    const store = (id, x) => { if (x.type !== 'mc') delete x.options; db.prepare('INSERT OR REPLACE INTO questions(id,data,archived) VALUES(?,?,0)').run(id, JSON.stringify({ id, ...x })); loadQuestions(); };
    if (p === '/api/admin/questions' && m === 'GET') {
      const f = k => (url.searchParams.get(k) || '').trim(), term = f('q').toLowerCase();
      let list = DATA.questions.filter(q => (!f('year') || q.year === f('year')) && (!f('subject') || q.subject === f('subject')) && (!term || (q.q + ' ' + q.topic).toLowerCase().includes(term)));
      list.sort((a, b) => (a.year + a.subject + a.topic).localeCompare(b.year + b.subject + b.topic));
      const uniq = k => [...new Set(DATA.questions.map(q => q[k]))].sort();
      return json(res, 200, { total: list.length, questions: list.slice(0, 100), years: DATA.yearGroups, subjects: uniq('subject'), topics: uniq('topic'), samples: DATA.questions.filter(q => BASE.questions.some(x => x.id === q.id)).length });
    }
    if (p === '/api/admin/questions' && m === 'POST') { const x = normQ(b), e = qErr(x); if (e) return json(res, 400, { error: e }); const id = 'man-' + crypto.randomBytes(5).toString('hex'); store(id, x); return json(res, 200, { id }); }
    if (p === '/api/admin/questions/remove-samples' && m === 'POST') { const a = db.prepare('UPDATE questions SET archived=1 WHERE id=?'); BASE.questions.forEach(q => a.run(q.id)); loadQuestions(); return json(res, 200, { ok: 1 }); }
    const qm = /^\/api\/admin\/questions\/([\w-]+)$/.exec(p);
    if (qm) {
      if (!QMAP[qm[1]]) return json(res, 404, { error: 'Not found' });
      if (m === 'DELETE') { db.prepare('UPDATE questions SET archived=1 WHERE id=?').run(qm[1]); loadQuestions(); return json(res, 200, { ok: 1 }); }
      if (m === 'PATCH') { const x = normQ(b), e = qErr(x); if (e) return json(res, 400, { error: e }); store(qm[1], x); return json(res, 200, { ok: 1 }); }
    }
    return json(res, 404, { error: 'Not found' });
  }

  // Practice endpoints require a paid/trial family
  if (!auth.isPaid(user)) return json(res, 402, { error: 'Your free trial or subscription has ended. Please contact UPlus to renew.' });

  if (p === '/api/questions' && m === 'GET') {
    const c = childFor(user, +url.searchParams.get('childId')); if (!c) return json(res, 404, { error: 'Not found' });
    const g = k => url.searchParams.get(k) || '';
    const qs = pickQuestions(c, { year: g('year'), subject: g('subject'), topic: g('topic'), n: Math.min(+g('n') || 10, 40) });
    return json(res, 200, { questions: qs.map(strip) });
  }
  if (p === '/api/answer' && m === 'POST') {
    const c = childFor(user, b.childId), q = QMAP[b.qid]; if (!c || !q) return json(res, 404, { error: 'Not found' });
    let correct, feedback = '';
    if (q.type === 'written' || (q.type === 'short' && (b.image || typeof b.selfCorrect === 'boolean'))) { // handwritten short answers are AI-read too
      if (typeof b.selfCorrect === 'boolean') correct = b.selfCorrect;
      else { const img = mark.parseImage(b.image); if (b.image && !img) return json(res, 400, { error: 'That photo could not be used. Try taking it again.' });
        if (!img && !String(b.given || '').trim()) return json(res, 400, { error: 'Add a photo of your working or type your answer.' });
        if (limited('ai:' + c.id, 40, 60e3)) return json(res, 429, { error: 'You are submitting very quickly. Please wait a moment and try again.' });
        let r = null; try { r = await mark.aiMark(q, b.given || '', img, b.lang === 'zh' ? 'zh' : 'en'); } catch (e) { if (e.busy) return json(res, 503, { error: 'Server is busy marking other answers. Please try again in a moment.' }); }
        if (!r) return json(res, 200, { needsSelfMark: true, answer: q.answer[0], explain: q.explain });
        if (!r.readable) return json(res, 200, { unreadable: true, feedback: r.feedback || 'I could not read that photo. Please retake it in good light, with the whole page in view.' });
        correct = r.correct; feedback = r.feedback; }
    } else correct = mark.markSimple(q, b.given || '');
    const ts = Date.now();
    db.prepare('INSERT INTO attempts(child_id,qid,correct,ms,mode,mock_id,day,ts) VALUES(?,?,?,?,?,?,?,?)').run(c.id, q.id, correct ? 1 : 0, Math.min(+b.ms || 0, 600000), b.mode || 'practice', b.mockId || null, today(), ts);
    return json(res, 200, { correct, answer: q.answer[0], explain: feedback || q.explain || '' });
  }
  if (p === '/api/mocks' && m === 'POST') {
    const c = childFor(user, b.childId); if (!c) return json(res, 404, { error: 'Not found' });
    const n = Math.min(+b.n || 15, 40), qs = pickQuestions(c, { year: c.year, n });
    if (!qs.length) return json(res, 400, { error: 'No questions for this year yet.' });
    const limit = Math.round(qs.length * 75); // 75s per question
    const id = db.prepare('INSERT INTO mocks(child_id,year,total,limit_s,started,qids) VALUES(?,?,?,?,?,?)').run(c.id, c.year, qs.length, limit, Date.now(), JSON.stringify(qs.map(q => q.id))).lastInsertRowid;
    return json(res, 200, { mockId: id, limitSecs: limit, questions: qs.map(strip) });
  }
  const fm = /^\/api\/mocks\/(\d+)\/finish$/.exec(p);
  if (fm && m === 'POST') {
    const mk = db.prepare('SELECT * FROM mocks WHERE id=?').get(+fm[1]); if (!mk || !childFor(user, mk.child_id)) return json(res, 404, { error: 'Not found' });
    const score = db.prepare('SELECT COUNT(DISTINCT qid) n FROM attempts WHERE mock_id=? AND correct=1').get(mk.id).n;
    db.prepare('UPDATE mocks SET finished=?, score=? WHERE id=?').run(Date.now(), score, mk.id);
    return json(res, 200, { score, total: mk.total, secs: Math.round((Date.now() - mk.started) / 1000), limitSecs: mk.limit_s });
  }
  return json(res, 404, { error: 'Not found' });
}

const cache = new Map();
function sendStatic(req, res, f) {
  const st = fs.statSync(f); let e = cache.get(f);
  if (!e || e.mtime !== st.mtimeMs) { const raw = fs.readFileSync(f); e = { mtime: st.mtimeMs, raw, etag: '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"', gz: /\.(html|js|css|svg)$/.test(f) ? zlib.gzipSync(raw) : null }; cache.set(f, e); }
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, { etag: e.etag }); return res.end(); }
  const gz = e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', etag: e.etag, 'cache-control': 'no-cache', vary: 'Accept-Encoding', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
  res.end(gz ? e.gz : e.raw);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/healthz') { db.prepare('SELECT 1').get(); return json(res, 200, { ok: 1 }); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let f = path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    sendStatic(req, res, f);
  } catch (e) { console.error(e); if (!res.headersSent) json(res, 500, { error: 'Server error' }); }
});
server.listen(process.env.PORT || 3000, () => console.log('UPlus running on http://localhost:' + (process.env.PORT || 3000)));

// ---- housekeeping: expired sessions, nightly backups, clean shutdown
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
function backup() { try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); const f = path.join(BACKUP_DIR, `uplus-${today()}.db`);
  if (!fs.existsSync(f)) db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  fs.readdirSync(BACKUP_DIR).filter(x => /^uplus-.*\.db$/.test(x)).sort().slice(0, -7).forEach(x => fs.unlinkSync(path.join(BACKUP_DIR, x))); } catch (e) { console.error('backup failed:', e.message); } }
setInterval(() => { try { auth.purgeSessions(); } catch {} backup(); }, 6 * 3600e3).unref(); setTimeout(backup, 60e3).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); });
