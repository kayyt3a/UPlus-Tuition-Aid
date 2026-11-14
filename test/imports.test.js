const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const imports = require('../server/imports');

const fresh = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE questions(id TEXT PRIMARY KEY, data TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE drafts(id INTEGER PRIMARY KEY, batch TEXT, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL);`);
  imports.ensureSchema(db); return db;
};
const item = (o = {}) => ({ year: 'Year 5', subject: 'Maths', topic: 'Fractions', type: 'short', q: 'What is 1/2 + 1/4?', options: [], answer: ['3/4'], explain: '', answerFromBooklet: true, hasFigure: false, page: 2, ...o });
const rows = db => db.prepare('SELECT id, data, archived FROM questions').all().map(r => ({ ...JSON.parse(r.data), archived: r.archived }));

test('isComplete', () => {
  assert.equal(imports.isComplete({ type: 'short', q: 'x', answer: ['1'] }), true);
  assert.equal(imports.isComplete({ type: 'short', q: 'x', answer: [] }), false);
  assert.equal(imports.isComplete({ type: 'short', q: '', answer: ['1'] }), false);
  assert.equal(imports.isComplete({ type: 'mc', q: 'x', options: ['a', 'b'], answer: ['b'] }), true);
  assert.equal(imports.isComplete({ type: 'mc', q: 'x', options: ['a', 'b'], answer: ['c'] }), false);
  assert.equal(imports.isComplete({ type: 'mc', q: 'x', options: ['a'], answer: ['a'] }), false);
});

test('saveImport puts questions straight into the bank with booklet metadata', () => {
  const db = fresh();
  const r = imports.saveImport(db, { name: 'Fractions.pdf', year: 'Year 5', subject: 'Maths', now: 1000, items: [
    item({ page: 3 }),
    item({ q: 'Which is bigger?', type: 'mc', options: ['1/2', '1/3'], answer: ['1/2'], answerFromBooklet: false, hasFigure: true, page: 4 }),
    item({ q: 'Broken', type: 'mc', options: ['a', 'b'], answer: ['c'] })
  ] });
  assert.equal(r.added, 3); assert.equal(r.needsFix, 1); assert.match(r.batch, /^b1000-[0-9a-f]{6}$/);
  const qs = rows(db).sort((a, b) => a.imp.order - b.imp.order);
  assert.equal(qs.length, 3);
  assert.ok(qs.every(q => /^imp-[0-9a-f]{10}$/.test(q.id) && q.archived === 0 && q.imp.batch === r.batch));
  assert.deepEqual(qs[0].imp, { batch: r.batch, order: 0, page: 3, aiAnswer: false, figure: false, needsFix: false });
  assert.deepEqual(qs[1].imp, { batch: r.batch, order: 1, page: 4, aiAnswer: true, figure: true, needsFix: false });
  assert.equal(qs[2].imp.needsFix, true);
  assert.equal('options' in qs[0], false, 'non-mc questions have no options');
  assert.deepEqual(qs[1].options, ['1/2', '1/3']);
  assert.deepEqual(db.prepare('SELECT name, year, subject, created FROM imports').all().map(x => ({ ...x })), [{ name: 'Fractions.pdf', year: 'Year 5', subject: 'Maths', created: 1000 }]);
});

test('saveImport is all-or-nothing', () => {
  const db = fresh();
  assert.throws(() => imports.saveImport(db, { name: 'x.pdf', year: 'Year 5', subject: '', items: [item(), item({ page: 10n })] }));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM imports').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n, 0);
});

test('listImports counts live and marked questions per booklet, newest first', () => {
  const db = fresh();
  const a = imports.saveImport(db, { name: 'A.pdf', year: 'Year 4', subject: '', now: 1000, items: [item(), item({ q: 'Q2', answerFromBooklet: false })] });
  const b = imports.saveImport(db, { name: 'B.pdf', year: 'Year 5', subject: 'English', now: 2000, items: [item({ q: 'Q3', hasFigure: true }), item({ q: 'Q4' })] });
  const q4 = rows(db).find(q => q.q === 'Q4'); db.prepare('UPDATE questions SET archived=1 WHERE id=?').run(q4.id);
  const list = imports.listImports(db);
  assert.deepEqual(list.map(i => [i.batch, i.name, i.count, i.marked]), [[b.batch, 'B.pdf', 1, 1], [a.batch, 'A.pdf', 2, 1]]);
});

test('getImport returns questions in booklet order without removed ones', () => {
  const db = fresh();
  const r = imports.saveImport(db, { name: 'A.pdf', year: 'Year 5', subject: '', items: [item({ q: 'first' }), item({ q: 'second' }), item({ q: 'third' })] });
  const second = rows(db).find(q => q.q === 'second'); db.prepare('UPDATE questions SET archived=1 WHERE id=?').run(second.id);
  const g = imports.getImport(db, r.batch);
  assert.equal(g.name, 'A.pdf'); assert.deepEqual(g.questions.map(q => q.q), ['first', 'third']);
  assert.equal(imports.getImport(db, 'nope'), null);
});

test('mergeEdit keeps the booklet link and clears review markers', () => {
  const existing = { id: 'imp-1', q: 'old', imp: { batch: 'b1', order: 2, page: 5, aiAnswer: true, figure: true, needsFix: true } };
  assert.deepEqual(imports.mergeEdit(existing, { id: 'imp-1', q: 'new' }), { id: 'imp-1', q: 'new', imp: { batch: 'b1', order: 2, page: 5, aiAnswer: false, figure: true, needsFix: false } });
  assert.deepEqual(imports.mergeEdit({ id: 'man-1', q: 'old' }, { id: 'man-1', q: 'new' }), { id: 'man-1', q: 'new' });
  assert.deepEqual(imports.mergeEdit(undefined, { id: 'man-2', q: 'new' }), { id: 'man-2', q: 'new' });
});

test('markChecked clears the AI-answer marker only', () => {
  const db = fresh();
  imports.saveImport(db, { name: 'A.pdf', year: 'Year 5', subject: '', items: [item({ answerFromBooklet: false, hasFigure: true })] });
  const q = rows(db)[0];
  assert.equal(imports.markChecked(db, q.id), true);
  assert.deepEqual(rows(db)[0].imp, { ...q.imp, aiAnswer: false });
  assert.equal(imports.markChecked(db, 'imp-missing'), false);
});

test('migrateDrafts moves only pending drafts, once', () => {
  const db = fresh(), ins = db.prepare('INSERT INTO drafts(batch,data,status,created) VALUES(?,?,?,?)');
  ins.run('b111', JSON.stringify(item({ q: 'pending 1' })), 'pending', 111);
  ins.run('b111', JSON.stringify(item({ q: 'pending 2', answerFromBooklet: false })), 'pending', 112);
  ins.run('b111', JSON.stringify(item({ q: 'approved' })), 'approved', 113);
  ins.run('b222', JSON.stringify(item({ q: 'rejected' })), 'rejected', 222);
  assert.equal(imports.migrateDrafts(db), 2);
  assert.equal(imports.migrateDrafts(db), 0);
  const qs = rows(db);
  assert.deepEqual(qs.map(q => q.q).sort(), ['pending 1', 'pending 2']);
  assert.deepEqual(qs.map(q => q.id).sort(), ['imp-1', 'imp-2']);
  assert.deepEqual(imports.listImports(db).map(i => [i.batch, i.name, i.year, i.created, i.count, i.marked]), [['b111', 'Earlier import', 'Year 5', 111, 2, 1]]);
});
