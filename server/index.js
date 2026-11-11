const http = require('http'), fs = require('fs'), path = require('path');
const db = require('./db'), auth = require('./auth'), mark = require('./mark'), stats = require('./stats');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'questions.json'), 'utf8'));
let DATA, QMAP;
function loadQuestions() {
  const imported = db.prepare('SELECT data FROM questions').all().map(r => JSON.parse(r.data));
  const questions = [...BASE.questions, ...imported];
  DATA = { yearGroups: [...new Set([...BASE.yearGroups, ...questions.map(q => q.year)])].sort(), questions };
  QMAP = Object.fromEntries(questions.map(q => [q.id, q]));
}
loadQuestions();
const extract = require('./extract');
const rawBody = (req, max) => new Promise((ok, no) => { const ch = []; let n = 0; req.on('data', c => { n += c.length; if (n > max) { no(new Error('File too large')); req.destroy(); } else ch.push(c); }); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', no); });
const SIGNUP_CODE = process.env.SIGNUP_CODE || 'UPLUS';
const PUB = path.join(__dirname, '..', 'public');
const today = () => new Date().toISOString().slice(0, 10);
const strip = ({ answer, explain, ...q }) => q;

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c) return;
  auth.createUser('admin@uplus.test', 'UPlus Admin', 'admin123', 'admin');
  const pid = auth.createUser('parent@uplus.test', 'Demo Parent', 'parent123', 'parent', new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10));
  const cid = db.prepare('INSERT INTO children(user_id,name,year) VALUES(?,?,?)').run(pid, 'Mia', 'Year 5').lastInsertRowid;
  const qs = DATA.questions.filter(q => q.year === 'Year 5' || q.year === 'Year 4');
  const ins = db.prepare('INSERT INTO attempts(child_id,qid,correct,ms,mode,day,ts) VALUES(?,?,?,?,?,?,?)');
  for (let d = 9; d >= 0; d--) { if (d === 4 || d === 5) continue; const ts = Date.now() - d * 864e5;
    for (let k = 0; k < 6 + (d % 5) * 3; k++) { const q = qs[(k + d) % qs.length]; ins.run(cid, q.id, Math.random() < 0.55 + (9 - d) * 0.03 ? 1 : 0, 6000 + Math.random() * 25000 | 0, 'practice', new Date(ts).toISOString().slice(0, 10), ts + k); } }
  console.log('Seeded demo data: admin@uplus.test/admin123, parent@uplus.test/parent123');
}
seed();

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
  if (p === '/api/signup' && m === 'POST') {
    if (String(b.code || '').trim().toUpperCase() !== SIGNUP_CODE.toUpperCase()) return json(res, 403, { error: 'Invalid family code. Ask UPlus for your code.' });
    if (!/^\S+@\S+\.\S+$/.test(b.email || '') || (b.password || '').length < 8 || !(b.name || '').trim()) return json(res, 400, { error: 'Enter your name, a valid email and a password of 8+ characters.' });
    try { const id = auth.createUser(b.email, b.name, b.password); return json(res, 200, { ok: 1 }, { 'set-cookie': `sid=${auth.newSession(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` }); }
    catch { return json(res, 409, { error: 'That email already has an account.' }); }
  }
  if (p === '/api/login' && m === 'POST') {
    const u = auth.checkLogin(b.email, b.password || '');
    return u ? json(res, 200, { ok: 1 }, { 'set-cookie': `sid=${auth.newSession(u.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` }) : json(res, 401, { error: 'Wrong email or password.' });
  }
  if (p === '/api/logout') { auth.endSession(req.headers.cookie); return json(res, 200, { ok: 1 }, { 'set-cookie': 'sid=; Path=/; Max-Age=0' }); }
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
      const fams = db.prepare("SELECT id,name,email,paid_until,created FROM users WHERE role='parent' ORDER BY created DESC").all().map(f => ({ ...f, paid: !!auth.isPaid({ ...f, role: 'parent' }),
        children: db.prepare('SELECT id,name,year FROM children WHERE user_id=?').all(f.id).map(c => ({ ...c, total: db.prepare('SELECT COUNT(*) n FROM attempts WHERE child_id=?').get(c.id).n, week: stats(c.id, QMAP).week })) }));
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
      if (x.type === 'mc') q.options = x.options; db.prepare('INSERT OR REPLACE INTO questions VALUES(?,?)').run(q.id, JSON.stringify(q)); db.prepare("UPDATE drafts SET status='approved' WHERE id=?").run(d.id); };
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
        let r = null; try { r = await mark.aiMark(q, b.given || '', img); } catch {}
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let f = path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); json(res, 500, { error: 'Server error' }); }
}).listen(process.env.PORT || 3000, () => console.log('UPlus running on http://localhost:' + (process.env.PORT || 3000)));
