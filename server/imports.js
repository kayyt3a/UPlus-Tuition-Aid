// Booklet imports: extracted questions go straight into the live bank, grouped by the booklet they came from so the admin can read over and edit them.
const crypto = require('crypto');
const ensureSchema = db => db.exec('CREATE TABLE IF NOT EXISTS imports(batch TEXT PRIMARY KEY, name TEXT NOT NULL, year TEXT NOT NULL, subject TEXT, created INTEGER NOT NULL)');
const isComplete = x => !!(x.q && x.answer && x.answer.length && x.answer[0] && (x.type !== 'mc' || (x.options && x.options.length >= 2 && x.options.includes(x.answer[0]))));
const tx = (db, fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

function toQuestion(x, batch, order, id = 'imp-' + crypto.randomBytes(5).toString('hex')) {
  const q = { id, year: x.year, subject: x.subject, topic: x.topic, type: x.type, q: x.q, answer: x.answer || [], explain: x.explain || '' };
  if (x.type === 'mc') q.options = x.options || [];
  q.imp = { batch, order, page: x.page || null, aiAnswer: !x.answerFromBooklet, figure: !!x.hasFigure, needsFix: !isComplete(q) };
  return q;
}

function saveImport(db, { name, year, subject, items, now = Date.now() }) {
  const batch = 'b' + now + '-' + crypto.randomBytes(3).toString('hex');
  return tx(db, () => {
    db.prepare('INSERT INTO imports(batch,name,year,subject,created) VALUES(?,?,?,?,?)').run(batch, String(name || 'Booklet').slice(0, 120), year, subject || '', now);
    const ins = db.prepare('INSERT INTO questions(id,data,archived) VALUES(?,?,0)'); let needsFix = 0;
    items.forEach((x, i) => { const q = toQuestion(x, batch, i); if (q.imp.needsFix) needsFix++; ins.run(q.id, JSON.stringify(q)); });
    return { batch, added: items.length, needsFix };
  });
}

function listImports(db) {
  const agg = {};
  db.prepare(`SELECT json_extract(data,'$.imp.batch') b, COUNT(*) n, SUM(json_extract(data,'$.imp.aiAnswer') OR json_extract(data,'$.imp.figure') OR json_extract(data,'$.imp.needsFix')) mk
    FROM questions WHERE archived=0 AND json_extract(data,'$.imp.batch') IS NOT NULL GROUP BY b`).all().forEach(r => agg[r.b] = r);
  return db.prepare('SELECT * FROM imports ORDER BY created DESC').all().map(i => ({ ...i, count: (agg[i.batch] || {}).n || 0, marked: (agg[i.batch] || {}).mk || 0 }));
}

function getImport(db, batch) {
  const info = db.prepare('SELECT * FROM imports WHERE batch=?').get(batch); if (!info) return null;
  const questions = db.prepare("SELECT data FROM questions WHERE archived=0 AND json_extract(data,'$.imp.batch')=?").all(batch).map(r => JSON.parse(r.data)).sort((a, b) => a.imp.order - b.imp.order);
  return { ...info, questions };
}

// Saving an edit means the admin has looked at the question, so it is no longer "AI answer, unchecked" or incomplete.
const mergeEdit = (existing, next) => existing && existing.imp ? { ...next, imp: { ...existing.imp, aiAnswer: false, needsFix: false } } : next;

function markChecked(db, id) {
  const r = db.prepare('SELECT data FROM questions WHERE id=?').get(id); if (!r) return false;
  const q = JSON.parse(r.data); if (!q.imp) return false;
  q.imp.aiAnswer = false; db.prepare('UPDATE questions SET data=? WHERE id=?').run(JSON.stringify(q), id); return true;
}

function migrateDrafts(db) {
  const ds = db.prepare("SELECT * FROM drafts WHERE status='pending' ORDER BY created").all(); if (!ds.length) return 0;
  const groups = {}; ds.forEach(d => (groups[d.batch || 'b0'] ||= []).push(d));
  tx(db, () => { for (const [batch, list] of Object.entries(groups)) { const first = JSON.parse(list[0].data);
    db.prepare('INSERT OR IGNORE INTO imports(batch,name,year,subject,created) VALUES(?,?,?,?,?)').run(batch, 'Earlier import', first.year || '', first.subject || '', list[0].created);
    list.forEach((d, i) => { const q = toQuestion(JSON.parse(d.data), batch, i, 'imp-' + d.id);
      db.prepare('INSERT OR REPLACE INTO questions(id,data,archived) VALUES(?,?,0)').run(q.id, JSON.stringify(q));
      db.prepare("UPDATE drafts SET status='migrated' WHERE id=?").run(d.id); }); } });
  return ds.length;
}

module.exports = { ensureSchema, isComplete, saveImport, listImports, getImport, mergeEdit, markChecked, migrateDrafts };
