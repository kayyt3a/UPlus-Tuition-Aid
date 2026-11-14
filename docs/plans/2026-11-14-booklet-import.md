# Booklet Import (no approval stage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Booklet questions extracted by Claude go live for students immediately, and the admin reads over and edits them in a tidy per-booklet list instead of approving a queue.

**Architecture:** Extraction (`server/extract.js`) gets stricter rules and a pure, testable `parseResponse`. A new `server/imports.js` module owns everything about imported booklets: an `imports` table (one row per uploaded file), saving extracted questions straight into the live `questions` table with an `imp` metadata object (booklet, order, page, markers), listing/reading booklets, and a one-off migration of the old approval queue. `server/index.js` swaps the draft-approval endpoints for booklet endpoints. The admin Import screen (`public/app.js`) becomes an upload panel plus a list of booklets; each booklet opens a read-friendly view grouped by subject and topic with Edit / Remove / "Answer is correct".

**Tech Stack:** Node 22.5+ built-ins only (`node:http`, `node:sqlite`, `node:test`), vanilla JS front end, Claude Messages API via `fetch`.

**Spec:** `docs/specs/2026-11-13-booklet-import.md` (read it first).

## Global Constraints

- Zero npm dependencies. Use only Node built-ins (`node:test`, `node:assert/strict`, `node:sqlite`, `node:http`, `node:child_process`). Do not add a `node_modules` folder or any package.
- Node `>=22.5` (`package.json` engines). Tests run with `npm test`.
- Claude is the only AI provider, called through the existing `ANTHROPIC_API_KEY` (and `ANTHROPIC_BASE_URL`, `EXTRACT_MODEL`). No other AI or OCR service.
- No approval stage: extracted questions go live immediately. Incomplete questions (missing answer, or multiple-choice answer not matching an option) are saved but hidden from students until fixed.
- Every new UI string goes through `t('...')` and has a Simplified Chinese entry in `public/i18n.js`. Server error messages shown to the admin also need a Chinese entry (the client runs `t(j.error)`).
- Follow the existing code style: compact, few comments, one-line comments only where the reason is not obvious, `esc()` around every value put into HTML.
- Accepted uploads stay PDF, PNG, JPEG (+WebP) up to 30 MB. Diagrams stay as text descriptions with a marker (images are out of scope).
- Commit after each task. End every commit message with the line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `server/extract.js` | Prompt + call to Claude + turning Claude's text into question items | Modify |
| `server/imports.js` | Booklet imports: schema, save, list, read, edit-merge, mark checked, migrate old drafts, completeness check | Create |
| `server/index.js` | HTTP routes | Modify (import route, booklet routes, remove draft routes, hide incomplete, keep `imp` on edits) |
| `public/app.js` | Admin Import screen + booklet view | Modify (replace `importScreen`/`renderQueue`) |
| `public/i18n.js` | Chinese strings | Modify |
| `public/styles.css` | Booklet view styles | Modify |
| `test/extract.test.js` | Unit tests for extraction parsing and prompt rules | Create |
| `test/imports.test.js` | Unit tests for `server/imports.js` (in-memory SQLite) | Create |
| `test/fake-claude.js` | Stand-in Claude API for tests and manual UI checks | Create |
| `test/import-flow.test.js` | End-to-end HTTP test of the whole flow | Create |
| `test/i18n.test.js` | Every UI string has a Chinese translation | Create |
| `package.json` | Add `test` script | Modify |
| `README.md` | Update "Importing booklets" section | Modify |

Question data shape after this change (stored as JSON in `questions.data`):

```json
{ "id": "imp-3fa9c1d2e0", "year": "Year 5", "subject": "Maths", "topic": "Fractions", "type": "mc",
  "q": "…", "options": ["…"], "answer": ["…"], "explain": "…",
  "imp": { "batch": "b1763100000000-a1b2c3", "order": 0, "page": 3, "aiAnswer": false, "figure": false, "needsFix": false } }
```

`imp` exists only on questions that came from a booklet. `aiAnswer` = Claude wrote the answer, `figure` = refers to a diagram, `needsFix` = incomplete, hidden from students.

---

### Task 1: Stricter extraction rules and testable parsing

**Files:**
- Modify: `package.json`
- Modify: `server/extract.js` (whole file)
- Test: `test/extract.test.js`

**Interfaces:**
- Produces: `require('./extract')` exports `{ PROMPT: string, parseResponse(text: string, { year: string, subject: string }): Item[], extract({ buffer, mime, year, subject }): Promise<Item[]> }`
- `Item` = `{ year, subject, topic, type: 'mc'|'short'|'written', q, options: string[], answer: string[], explain, answerFromBooklet: boolean, hasFigure: boolean, page: number|null }` (same shape `extract` returns today).

- [ ] **Step 1: Add the test script**

Replace `package.json` with:

```json
{ "name": "uplus-ascend", "version": "0.2.0", "private": true, "scripts": { "start": "node --disable-warning=ExperimentalWarning server/index.js", "test": "node --disable-warning=ExperimentalWarning --test" }, "engines": { "node": ">=22.5" } }
```

- [ ] **Step 2: Write the failing tests**

Create `test/extract.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROMPT, parseResponse } = require('../server/extract');
const ctx = { year: 'Year 5', subject: 'Maths' };

test('prompt tells Claude to keep only real questions', () => {
  assert.match(PROMPT, /worked examples/i);
  assert.match(PROMPT, /teaching content/i);
  assert.match(PROMPT, /answer keys/i);
  assert.match(PROMPT, /duplicate/i);
  assert.match(PROMPT, /exactly as written/i);
});

test('reads the JSON array even with text around it, and maps fields', () => {
  const text = 'Here you go:\n[{"subject":"Maths","topic":"Fractions","type":"mc","q":" Which is 1/2? ","options":["2/4","1/3"],"answer":["2/4"],"explain":"2/4 = 1/2","answer_from_booklet":true,"has_figure":false,"page":3}]\nDone.';
  assert.deepEqual(parseResponse(text, ctx), [{ year: 'Year 5', subject: 'Maths', topic: 'Fractions', type: 'mc', q: 'Which is 1/2?', options: ['2/4', '1/3'], answer: ['2/4'], explain: '2/4 = 1/2', answerFromBooklet: true, hasFigure: false, page: 3 }]);
});

test('fills defaults, fixes bad types and single answers, drops empty questions', () => {
  const out = parseResponse(JSON.stringify([{ q: 'What is 6 x 7?', type: 'weird', answer: '42' }, { q: '   ' }, { topic: 'x' }]), { year: 'Year 4', subject: '' });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { year: 'Year 4', subject: 'Maths', topic: 'General', type: 'short', q: 'What is 6 x 7?', options: [], answer: ['42'], explain: '', answerFromBooklet: false, hasFigure: false, page: null });
});

test('drops duplicates but keeps same wording with different options', () => {
  const out = parseResponse(JSON.stringify([
    { q: 'What is 3 + 4?', answer: ['7'] }, { q: 'what is  3 + 4?', answer: ['7'] },
    { q: 'Which is biggest?', type: 'mc', options: ['1', '2'], answer: ['2'] }, { q: 'Which is biggest?', type: 'mc', options: ['5', '9'], answer: ['9'] }
  ]), ctx);
  assert.deepEqual(out.map(x => x.q), ['What is 3 + 4?', 'Which is biggest?', 'Which is biggest?']);
});

test('unreadable response gives a friendly error', () => {
  assert.throws(() => parseResponse('Sorry, I cannot help.', ctx), /Could not read the AI response/);
  assert.throws(() => parseResponse('{"q":"not an array"}', ctx), /Could not read the AI response/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `parseResponse is not a function` / `PROMPT` undefined.

- [ ] **Step 4: Rewrite `server/extract.js`**

Replace the whole file with:

```js
// Extracts questions from a booklet (PDF or images) using Claude. Questions go live straight away; the admin reads over them afterwards.
const PROMPT = `You are digitising a tuition-centre booklet (primary school, selective-school entrance preparation) into a flashcard question bank.
The booklet mixes teaching content with questions. Extract ONLY the questions the student is expected to answer.
Return ONLY a JSON array, in the order the questions appear in the booklet. Each item:
{"subject":"Maths|English|...","topic":"short topic name","type":"mc|short|written","q":"full question text","options":["..."],"answer":["accepted answer 1","accepted answer 2"],"explain":"1-2 sentence explanation suitable for a child","answer_from_booklet":true|false,"has_figure":true|false,"page":number}
Extract: every question in exercises, practice sets, homework, quizzes and test sections.
Never extract:
- Teaching content: explanations, notes, key points, tips, summaries, headings and instructions.
- Worked examples, even when they are written as a question, because the booklet already solves them for the student.
- Answer keys as separate items. Use answer keys only to fill in the answer of the matching question.
- Duplicates: if the same question appears more than once (for example again on a revision page), extract it once.
Rules:
- Copy each question exactly as written in the booklet. Do not reword, simplify or improve it. Only "explain" is written by you.
- type "mc" = multiple choice (options required, answer must exactly equal one option's text); "short" = a single number/word/short phrase answer; "written" = working out or sentences (answer = a model answer).
- If the booklet gives the answer, use it and set answer_from_booklet true. If not, work out the answer yourself and set answer_from_booklet false.
- If a question depends on a diagram, graph, table or picture you cannot fully express in text, describe it in the question text as best you can and set has_figure true.
- Reading passages: copy the passage into each question that needs it, or write "Passage: ..." at the start of q.
- Do not invent questions.`;

function parseResponse(text, { year, subject }) {
  let arr = null; try { arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch {}
  if (!Array.isArray(arr)) throw new Error('Could not read the AI response. Try a smaller file or fewer pages.');
  const seen = new Set();
  return arr.filter(x => x && typeof x.q === 'string' && x.q.trim()).map(x => ({
    year, subject: x.subject || subject || 'Maths', topic: x.topic || 'General', type: ['mc', 'short', 'written'].includes(x.type) ? x.type : 'short',
    q: x.q.trim(), options: Array.isArray(x.options) ? x.options.map(String) : [], answer: (Array.isArray(x.answer) ? x.answer : [x.answer]).filter(a => a != null).map(String),
    explain: String(x.explain || ''), answerFromBooklet: !!x.answer_from_booklet, hasFigure: !!x.has_figure, page: +x.page || null }))
    .filter(x => { const k = (x.q + '|' + x.options.join('|')).toLowerCase().replace(/\s+/g, ' '); return !seen.has(k) && seen.add(k); });
}

async function extract({ buffer, mime, year, subject }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI extraction needs ANTHROPIC_API_KEY set on the server.');
  const isPdf = mime === 'application/pdf';
  const block = { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
  const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(10 * 60e3), headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.EXTRACT_MODEL || 'claude-sonnet-5-5', max_tokens: 32000,
      messages: [{ role: 'user', content: [block, { type: 'text', text: `${PROMPT}\nYear group: ${year}${subject ? `\nSubject: ${subject}` : ''}` }] }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'AI request failed');
  return parseResponse((j.content || []).map(c => c.text || '').join(''), { year, subject });
}
module.exports = { PROMPT, parseResponse, extract };
```

Note: `server/index.js` calls `extract.extract(...)`; that still works.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json server/extract.js test/extract.test.js
git commit -m "Extract only student questions: skip teaching content, worked examples and duplicates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `server/imports.js` — booklets saved straight into the live question bank

**Files:**
- Create: `server/imports.js`
- Test: `test/imports.test.js`

**Interfaces:**
- Consumes: `Item` objects from Task 1 (`answerFromBooklet`, `hasFigure`, `page` fields).
- Produces (all take a `node:sqlite` `DatabaseSync` as first arg where shown):
  - `ensureSchema(db): void` — creates `imports(batch TEXT PRIMARY KEY, name TEXT NOT NULL, year TEXT NOT NULL, subject TEXT, created INTEGER NOT NULL)`.
  - `isComplete(q): boolean` — has question text and an answer; for `mc`, 2+ options and `answer[0]` is one of them.
  - `saveImport(db, { name, year, subject, items, now? }): { batch, added, needsFix }` — all-or-nothing (transaction).
  - `listImports(db): Array<{ batch, name, year, subject, created, count, marked }>` newest first; `count`/`marked` ignore removed questions.
  - `getImport(db, batch): { batch, name, year, subject, created, questions: Question[] } | null` — questions in booklet order, removed ones excluded.
  - `mergeEdit(existing, next): object` — keeps `existing.imp`, sets `aiAnswer` and `needsFix` to false.
  - `markChecked(db, id): boolean` — sets `imp.aiAnswer = false`.
  - `migrateDrafts(db): number` — moves pending rows of the old `drafts` table into the bank, grouped by draft batch, booklet name `"Earlier import"`.

- [ ] **Step 1: Write the failing tests**

Create `test/imports.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../server/imports'`.

- [ ] **Step 3: Create `server/imports.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all extract and imports tests).

- [ ] **Step 5: Commit**

```bash
git add server/imports.js test/imports.test.js
git commit -m "Add imports module: booklet questions saved live with review markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server routes — no approval stage, booklet endpoints, end-to-end test

**Files:**
- Create: `test/fake-claude.js`
- Test: `test/import-flow.test.js`
- Modify: `server/index.js`
- Modify: `README.md` ("Importing booklets" section)

**Interfaces:**
- Consumes: `extract.extract` (Task 1); `imports.*` (Task 2).
- Produces HTTP API (admin only, JSON):
  - `POST /api/admin/import?year=&subject=&name=` body = raw file → `200 { batch, added, needsFix }`; `400 { error: 'No questions were found in this file.' }` when nothing extracted (nothing saved).
  - `GET /api/admin/imports` → `{ imports: [{ batch, name, year, subject, created, count, marked }], years: string[] }`
  - `GET /api/admin/imports/:batch` → `{ batch, name, year, subject, created, questions: Question[], years, subjects, topics }`, 404 if unknown.
  - `POST /api/admin/questions/:id/checked` → `{ ok: 1 }`, 404 if not an imported question.
  - Existing `PATCH /api/admin/questions/:id` keeps `imp` (via `mergeEdit`); existing `DELETE` unchanged.
  - Removed: `GET /api/admin/drafts`, `POST /api/admin/drafts/approve-all`, `PATCH|POST /api/admin/drafts/:id[/approve|reject]`.
  - Student endpoints never return `imp` and never include questions with `imp.needsFix`.
- Produces `test/fake-claude.js`: `startFakeClaude(replies: object[][], port = 0, repeat = false): Promise<{ url: string, close(): void }>` — each request answers with the next queued array (raw Claude item format, e.g. `answer_from_booklet`); with `repeat`, always `replies[0]`. Run directly (`node test/fake-claude.js`) it serves `SAMPLE` forever on port 4999.

- [ ] **Step 1: Create the fake Claude API**

Create `test/fake-claude.js`:

```js
// Stand-in for the Claude Messages API so the import flow can be tested (and the UI tried out) without a key or network.
const http = require('node:http');
const SAMPLE = [
  { subject: 'Maths', topic: 'Fractions', type: 'mc', q: 'Which fraction is equal to one quarter?', options: ['2/8', '1/3', '3/4', '2/5'], answer: ['2/8'], explain: '2/8 simplifies to 1/4.', answer_from_booklet: true, has_figure: false, page: 3 },
  { subject: 'Maths', topic: 'Fractions', type: 'short', q: 'What is 1/2 + 1/4?', answer: ['3/4'], explain: '1/2 is 2/4, and 2/4 + 1/4 = 3/4.', answer_from_booklet: false, has_figure: false, page: 4 },
  { subject: 'Maths', topic: 'Area', type: 'short', q: 'The rectangle in the diagram is 6 cm long and 4 cm wide. What is its area in cm²?', answer: ['24', '24 cm²'], explain: 'Area = 6 × 4 = 24 cm².', answer_from_booklet: true, has_figure: true, page: 7 },
  { subject: 'Maths', topic: 'Area', type: 'mc', q: 'Which shape has the largest area?', options: ['A 3×3 square', 'A 2×5 rectangle'], answer: ['A 4×4 square'], explain: '', answer_from_booklet: true, has_figure: false, page: 8 }
];
function startFakeClaude(replies, port = 0, repeat = false) {
  const server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => { const items = repeat ? replies[0] : replies.shift() || [];
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(items) }] })); });
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
module.exports = { startFakeClaude, SAMPLE };
if (require.main === module) startFakeClaude([SAMPLE], 4999, true).then(f => console.log('Fake Claude on ' + f.url + ' (set ANTHROPIC_BASE_URL to this and ANTHROPIC_API_KEY to anything)'));
```

Note: in tests each request takes the next queued reply (an empty array if none is queued). Run standalone (`repeat = true`), it answers every upload with `SAMPLE`.

- [ ] **Step 2: Write the failing end-to-end test**

Create `test/import-flow.test.js`:

```js
// End-to-end: booklet upload → questions live for students → admin reads over, fixes, checks and removes them.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { startFakeClaude } = require('./fake-claude');

const replies = [];
let fake, app, base;
const ITEMS = [
  { subject: 'Maths', topic: 'Fractions', type: 'mc', q: 'Which fraction equals one quarter? (import test)', options: ['2/8', '1/3', '3/4'], answer: ['2/8'], explain: '2/8 = 1/4', answer_from_booklet: true, has_figure: false, page: 3 },
  { subject: 'Maths', topic: 'Fractions', type: 'short', q: 'What is 1/2 + 1/4? (import test)', answer: ['3/4'], explain: '', answer_from_booklet: false, has_figure: false, page: 4 },
  { subject: 'Maths', topic: 'Fractions', type: 'mc', q: 'Which is the biggest? (import test)', options: ['1/2', '1/3'], answer: ['2/3'], explain: '', answer_from_booklet: true, has_figure: true, page: 5 }
];

before(async () => {
  fake = await startFakeClaude(replies);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uplus-test-')), port = 41000 + Math.floor(Math.random() * 2000);
  base = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), DB_FILE: path.join(dir, 't.db'), BACKUP_DIR: path.join(dir, 'b'), NODE_ENV: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
      RATE_LIMIT: 'off', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: fake.url }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, no) => { app.stdout.on('data', d => /UPlus running/.test(d) && ok()); app.on('exit', c => no(new Error('server exited with ' + c))); });
});
after(() => { if (app) app.kill(); if (fake) fake.close(); });

async function login(email, password) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0];
}
async function call(cookie, p, { method = 'GET', body, type = 'application/json' } = {}) {
  const r = await fetch(base + p, { method, headers: { cookie, 'content-type': type }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
const upload = (cookie, name) => call(cookie, `/api/admin/import?year=Year%205&subject=Maths&name=${encodeURIComponent(name)}`, { method: 'POST', body: Buffer.from('%PDF-1.4 test'), type: 'application/pdf' });

test('imported questions go live, and the admin can read over, fix, check and remove them', async () => {
  const admin = await login('admin@uplus.test', 'admin123'), parent = await login('parent@uplus.test', 'parent123');
  replies.push(ITEMS);
  const up = await upload(admin, 'Fractions.pdf');
  assert.equal(up.status, 200); assert.equal(up.json.added, 3); assert.equal(up.json.needsFix, 1);

  const list = await call(admin, '/api/admin/imports');
  assert.deepEqual(list.json.imports.map(i => [i.name, i.year, i.count, i.marked]), [['Fractions.pdf', 'Year 5', 3, 2]]);
  assert.ok(Array.isArray(list.json.years));

  const view = await call(admin, '/api/admin/imports/' + up.json.batch);
  assert.deepEqual(view.json.questions.map(q => q.imp.page), [3, 4, 5]);
  assert.ok(Array.isArray(view.json.subjects) && Array.isArray(view.json.topics) && Array.isArray(view.json.years));
  const [q1, q2, q3] = view.json.questions;
  assert.equal(q2.imp.aiAnswer, true); assert.equal(q3.imp.needsFix, true);

  const childId = (await call(parent, '/api/me')).json.children[0].id;
  const studentSees = async () => (await call(parent, `/api/questions?childId=${childId}&year=Year%205&subject=Maths&n=40`)).json.questions;
  let seen = await studentSees();
  assert.ok(seen.some(q => q.id === q1.id) && seen.some(q => q.id === q2.id), 'complete questions are live immediately');
  assert.ok(!seen.some(q => q.id === q3.id), 'incomplete question is hidden');
  assert.ok(seen.every(q => !('answer' in q) && !('imp' in q)), 'students never get answers or import metadata');

  const fix = await call(admin, '/api/admin/questions/' + q3.id, { method: 'PATCH', body: { year: 'Year 5', subject: 'Maths', topic: 'Fractions', type: 'mc', q: q3.q, options: ['1/2', '1/3', '2/3'], answer: ['2/3'], explain: '' } });
  assert.equal(fix.status, 200);
  assert.ok((await studentSees()).some(q => q.id === q3.id), 'fixed question goes live');

  assert.equal((await call(admin, `/api/admin/questions/${q2.id}/checked`, { method: 'POST', body: {} })).status, 200);
  const after1 = (await call(admin, '/api/admin/imports/' + up.json.batch)).json.questions;
  assert.equal(after1.find(q => q.id === q3.id).imp.batch, up.json.batch, 'edits keep the booklet link');
  assert.equal(after1.find(q => q.id === q3.id).imp.needsFix, false);
  assert.equal(after1.find(q => q.id === q2.id).imp.aiAnswer, false);
  assert.equal((await call(admin, '/api/admin/imports')).json.imports[0].marked, 1, 'q3 still refers to a diagram');

  assert.equal((await call(admin, '/api/admin/questions/' + q1.id, { method: 'DELETE', body: {} })).status, 200);
  assert.ok(!(await studentSees()).some(q => q.id === q1.id), 'removed question is gone for students');
  assert.equal((await call(admin, '/api/admin/imports')).json.imports[0].count, 2);
});

test('a file with no questions is reported and nothing is saved', async () => {
  const admin = await login('admin@uplus.test', 'admin123');
  replies.push([]);
  const up = await upload(admin, 'Notes only.pdf');
  assert.equal(up.status, 400); assert.equal(up.json.error, 'No questions were found in this file.');
  assert.equal((await call(admin, '/api/admin/imports')).json.imports.length, 1);
});

test('old approval endpoints are gone and parents cannot use booklet endpoints', async () => {
  const admin = await login('admin@uplus.test', 'admin123'), parent = await login('parent@uplus.test', 'parent123');
  assert.equal((await call(admin, '/api/admin/drafts')).status, 404);
  assert.equal((await call(parent, '/api/admin/imports')).status, 403);
  assert.equal((await call(admin, '/api/admin/imports/nope')).status, 404);
});
```

Note on the fake: each upload consumes one queued reply, so every test pushes its reply right before uploading.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. The upload returns `added` but no `batch`, and `/api/admin/imports` returns 404.

- [ ] **Step 4: Wire `server/imports.js` in at startup and hide incomplete questions**

In `server/index.js`, directly after the line
`db.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)');`
add:

```js
const imports = require('./imports');
imports.ensureSchema(db); imports.migrateDrafts(db); // questions still waiting in the old approval queue go live once, as an "Earlier import"
```

In `loadQuestions()`, replace
`const active = rows.filter(r => !r.arch).map(r => r.q);`
with:

```js
  const active = rows.filter(r => !r.arch && !(r.q.imp && r.q.imp.needsFix)).map(r => r.q); // incomplete imports stay hidden until the admin fixes them
```

Directly after the `loadQuestions();` call that follows that function, add:

```js
const uniq = k => [...new Set(DATA.questions.map(q => q[k]))].sort();
```

Replace
`const strip = ({ answer, explain, ...q }) => q;`
with:

```js
const strip = ({ answer, explain, imp, ...q }) => q;
```

- [ ] **Step 5: Replace the import route and the draft routes**

In `server/index.js`, replace the whole block from
`if (p === '/api/admin/import' && m === 'POST') {`
down to and including the closing `}` of the `if (dm) { ... }` block (the line ending `approve(d); loadQuestions(); return json(res, 200, { ok: 1 }); }` followed by `    }`), with:

```js
    if (p === '/api/admin/import' && m === 'POST') {
      const mime = (req.headers['content-type'] || '').split(';')[0], g = k => (url.searchParams.get(k) || '').trim(), year = g('year'), subject = g('subject');
      if (!/^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(mime)) return json(res, 400, { error: 'Upload a PDF or a PNG/JPEG image.' });
      if (!year) return json(res, 400, { error: 'Choose a year group first.' });
      let buf; try { buf = await rawBody(req, 30 * 1024 * 1024); } catch (e) { return json(res, 413, { error: 'File too large (max 30 MB). Split the booklet into smaller parts.' }); }
      let items; try { items = await extract.extract({ buffer: buf, mime, year, subject }); } catch (e) { return json(res, 502, { error: e.message }); }
      if (!items.length) return json(res, 400, { error: 'No questions were found in this file.' });
      const r = imports.saveImport(db, { name: g('name') || 'Booklet', year, subject, items }); loadQuestions(); return json(res, 200, r);
    }
    if (p === '/api/admin/imports' && m === 'GET') return json(res, 200, { imports: imports.listImports(db), years: DATA.yearGroups });
    const im = /^\/api\/admin\/imports\/([\w-]+)$/.exec(p);
    if (im && m === 'GET') { const r = imports.getImport(db, im[1]); if (!r) return json(res, 404, { error: 'Not found' });
      return json(res, 200, { ...r, years: DATA.yearGroups, subjects: uniq('subject'), topics: uniq('topic') }); }
    const ck = /^\/api\/admin\/questions\/([\w-]+)\/checked$/.exec(p);
    if (ck && m === 'POST') { if (!imports.markChecked(db, ck[1])) return json(res, 404, { error: 'Not found' }); loadQuestions(); return json(res, 200, { ok: 1 }); }
    const valid = imports.isComplete;
```

(`valid` is still used by `qErr` further down. The old `approve` helper and every `/api/admin/drafts` route are now gone.)

- [ ] **Step 6: Keep the booklet link when a question is edited**

In `server/index.js`, replace
`const store = (id, x) => { if (x.type !== 'mc') delete x.options; db.prepare('INSERT OR REPLACE INTO questions(id,data,archived) VALUES(?,?,0)').run(id, JSON.stringify({ id, ...x })); loadQuestions(); };`
with:

```js
    const store = (id, x) => { if (x.type !== 'mc') delete x.options; db.prepare('INSERT OR REPLACE INTO questions(id,data,archived) VALUES(?,?,0)').run(id, JSON.stringify(imports.mergeEdit(QMAP[id], { id, ...x }))); loadQuestions(); };
```

In the `GET /api/admin/questions` handler, delete the now-duplicate local line
`const uniq = k => [...new Set(DATA.questions.map(q => q[k]))].sort();`
(the module-level `uniq` from Step 4 replaces it).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all tests in all four files).

Also run: `node --check server/index.js` → no output.

- [ ] **Step 8: Update the README**

In `README.md`, replace the whole `## Importing booklets (drag & drop)` section body (the paragraph under that heading) with:

```markdown
Log in as admin → **Import**. Pick the year group, drop a PDF (or page photos, max 30 MB each; split long booklets). Claude keeps only the questions students should answer: teaching content, worked examples, answer keys and duplicates are skipped, and the booklet's wording is kept. **Questions go live for students straight away.** You then land on the booklet's page: questions grouped by subject and topic, shown as students see them, with **Edit**, **Remove** and **Answer is correct**. Markers show what to check first: answers Claude worked out itself, questions that refer to a diagram, and incomplete questions (hidden from students until you fix them). "Only marked" shows just those. Earlier booklets stay listed on the Import page. Needs `ANTHROPIC_API_KEY` (optional `EXTRACT_MODEL`).

To try the import screen without a key: run `node test/fake-claude.js`, then start the app with `ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:4999 npm start`. Every upload then returns four sample questions.
```

Also add `npm test` under the `## Run` code block: change `    npm start            # http://localhost:3000` to:

```
    npm start            # http://localhost:3000
    npm test             # automated tests (no API key needed)
```

- [ ] **Step 9: Commit**

```bash
git add server/index.js test/fake-claude.js test/import-flow.test.js README.md
git commit -m "Booklet questions go live on import; replace approval queue with booklet endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin screens — booklet list and read-over-and-edit view

**Files:**
- Test: `test/i18n.test.js`
- Modify: `public/app.js` (replace the `// ---------- admin: booklet import ----------` section: `importScreen` and `renderQueue`, which ends right before `boot();`)
- Modify: `public/i18n.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: Task 3 endpoints. Existing helpers in `public/app.js`: `api(path, opts)`, `t()`, `esc()`, `yl()` (year label), `sl()` (subject label), `ico()`, `LS`, `LANG`, `setNav()`, `cur`, `TYPES()`, `qForm(question)`, `wireForm(el, onSave, onCancel)`.
- Produces: `importScreen(err?: string)` and `bookletView(batch: string)`. The nav map already calls `importScreen()` for the Import tab; leave it unchanged.

- [ ] **Step 1: Write the failing translation test**

Create `test/i18n.test.js`:

```js
// Every interface string has a Simplified Chinese translation (missing ones would silently show English).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
global.window = {}; require('../public/i18n.js'); const ZH = window.ZH;

test('every t(...) string in app.js has a Chinese entry', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const re = /\bt\('((?:[^'\\]|\\.)*)'/g, missing = []; let m;
  while ((m = re.exec(src))) { const k = m[1].replace(/\\'/g, "'"); if (!(k in ZH)) missing.push(k); }
  assert.deepEqual([...new Set(missing)], []);
});

test('booklet import server messages have Chinese entries', () => {
  for (const k of ['No questions were found in this file.', 'AI extraction needs ANTHROPIC_API_KEY set on the server.', 'Could not read the AI response. Try a smaller file or fewer pages.', 'File too large (max 30 MB). Split the booklet into smaller parts.'])
    assert.ok(k in ZH, 'missing: ' + k);
});

test('the booklet view uses its new strings', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const k of ['Imported booklets', 'Only marked ({n})', 'Answer is correct', 'Incomplete: hidden from students until fixed']) assert.ok(src.includes(`t('${k}'`), 'app.js should use: ' + k);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL in `i18n.test.js` (the server messages and the new strings are missing). The other test files still pass.

- [ ] **Step 3: Replace the import section of `public/app.js`**

Replace everything from the line `// ---------- admin: booklet import ----------` up to (not including) the final `boot();` line with:

```js
// ---------- admin: booklet import (questions go live straight away; the admin reads over and edits them) ----------
let IMP = { batch: null, filter: 'all', note: '' };
const when = ms => new Date(ms).toLocaleDateString(LANG === 'zh' ? 'zh-CN' : 'en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const bookletName = n => n === 'Earlier import' ? t('Earlier import') : n;
async function importScreen(err) {
  cur = importScreen; setNav('import');
  const { imports, years } = await api('/admin/imports');
  app.innerHTML = `<div class="head"><p class="eyebrow">${t('Administration')}</p><h1>${t('Import a booklet')}</h1><p class="muted" style="margin-top:6px">${t('Drop a PDF or page photos. Only the questions are kept, and they go live for students straight away. Read over them below and fix anything that needs it.')}</p></div>
    <div class="panel"><div class="row"><div><label style="margin-top:0">${t('Year group')}</label><input type="text" id="iy" list="yl" value="${esc(LS.get('iy') || years[0] || 'Year 5')}"><datalist id="yl">${years.map(y => `<option>${esc(y)}</option>`).join('')}</datalist></div>
    <div><label style="margin-top:0">${t('Subject (optional)')}</label><input type="text" id="is" placeholder="${t('Maths, English… or leave blank')}" value="${esc(LS.get('is') || '')}"></div></div>
    <div id="drop" class="drop">${ico('upload')}<br>${t('Drag and drop a booklet here, or click to choose')}<br><span class="muted">${t('PDF, PNG or JPEG · up to 30 MB · upload long booklets in parts')}</span></div>
    <input type="file" id="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple hidden><div id="st" class="muted" style="margin-top:10px">${typeof err === 'string' ? `<span class="err">${esc(err)}</span>` : ''}</div></div>
    <div class="panel blist"><h2>${t('Imported booklets')}</h2>${imports.length ? imports.map(i => `<div class="brow"><div><b>${esc(bookletName(i.name))}</b><div class="muted">${esc(when(i.created))} · ${esc(yl(i.year))} · ${t('{n} questions', { n: i.count })}</div></div>
      <div class="bact">${i.marked ? `<span class="tag warn">${t('{n} to check', { n: i.marked })}</span>` : ''}<button class="btn small secondary" data-b="${esc(i.batch)}">${t('Open')}</button></div></div>`).join('') : `<p class="empty">${t('No booklets imported yet.')}</p>`}</div>`;
  const drop = $('#drop'), st = $('#st');
  const upload = async files => {
    const year = $('#iy').value.trim(), subject = $('#is').value.trim(); LS.set('iy', year); LS.set('is', subject);
    if (!year) return (st.textContent = t('Enter a year group first.'));
    let last = null, added = 0, fix = 0;
    for (const f of files) {
      st.textContent = t('Reading {f}… this can take a minute or two.', { f: f.name });
      try { const r = await fetch('/api/admin/import?' + new URLSearchParams({ year, subject, name: f.name }), { method: 'POST', headers: { 'content-type': f.type }, body: f });
        const j = await r.json(); if (!r.ok) throw new Error(t(j.error)); last = j.batch; added += j.added; fix += j.needsFix; }
      catch (e) { return importScreen(`${f.name}: ${e.message}`); }
    }
    if (files.length === 1 && last) { IMP = { batch: last, filter: 'all', note: t('{n} questions added. They are live for students now.', { n: added }) + (fix ? ' ' + t('{n} are incomplete and hidden from students until you fix them.', { n: fix }) : '') }; return bookletView(last); }
    importScreen();
  };
  drop.onclick = () => $('#file').click(); $('#file').onchange = e => upload([...e.target.files]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); };
  app.querySelectorAll('[data-b]').forEach(b => b.onclick = () => bookletView(b.dataset.b));
}
async function bookletView(batch) {
  cur = () => bookletView(batch); setNav('import');
  let r; try { r = await api('/admin/imports/' + encodeURIComponent(batch)); } catch { return importScreen(); }
  if (IMP.batch !== batch) IMP = { batch, filter: 'all', note: '' };
  const note = IMP.note; IMP.note = '';
  const typeName = Object.fromEntries(TYPES()), marked = q => q.imp.aiAnswer || q.imp.figure || q.imp.needsFix;
  const nMarked = r.questions.filter(marked).length, shown = IMP.filter === 'marked' ? r.questions.filter(marked) : r.questions;
  const groups = []; shown.forEach(q => { let g = groups.find(x => x.subject === q.subject && x.topic === q.topic); if (!g) groups.push(g = { subject: q.subject, topic: q.topic, qs: [] }); g.qs.push(q); });
  const answerLine = q => `<div class="bans"><b>${t('Answer')}:</b> ${esc((q.answer || []).join(' / ')) || '—'}</div>`;
  const card = q => `<div class="panel bq" data-id="${esc(q.id)}">
    <div>${q.imp.needsFix ? `<span class="tag bad">${t('Incomplete: hidden from students until fixed')}</span> ` : ''}${q.imp.aiAnswer ? `<span class="tag warn">${t('Answer written by AI: check it')}</span> ` : ''}${q.imp.figure ? `<span class="tag warn">${t('Refers to a diagram')}</span> ` : ''}${q.imp.page ? `<span class="tag">${t('Page {n}', { n: q.imp.page })}</span> ` : ''}<span class="tag">${typeName[q.type] || esc(q.type)}</span></div>
    <div class="qtext">${esc(q.q)}</div>
    ${q.type === 'mc' ? `<ol class="bopts" type="A">${(q.options || []).map(o => `<li class="${(q.answer || []).includes(o) ? 'right' : ''}">${esc(o)}</li>`).join('')}</ol>${(q.options || []).includes((q.answer || [])[0]) ? '' : answerLine(q)}` : answerLine(q)}
    ${q.explain ? `<div class="muted"><b>${t('Explanation')}:</b> ${esc(q.explain)}</div>` : ''}
    <div class="bact"><button class="btn small secondary" data-a="edit">${t('Edit')}</button>${q.imp.aiAnswer && !q.imp.needsFix ? `<button class="btn small secondary" data-a="ok">${t('Answer is correct')}</button>` : ''}<button class="btn small ghost" data-a="del">${t('Remove')}</button></div></div>`;
  app.innerHTML = `<button class="btn small ghost" id="back">← ${t('All booklets')}</button>
    <div class="head"><p class="eyebrow">${t('Imported booklet')}</p><h1>${esc(bookletName(r.name))}</h1><p class="muted" style="margin-top:6px">${esc(when(r.created))} · ${esc(yl(r.year))} · ${t('{n} questions', { n: r.questions.length })}</p></div>
    ${note ? `<div class="panel"><p>${esc(note)}</p></div>` : ''}
    <datalist id="dl-y">${r.years.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl-s">${r.subjects.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl-t">${r.topics.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <p class="muted">${t('These questions are live for students. Read over them and fix anything that needs it.')}</p>
    <div class="seg"><button class="btn small ${IMP.filter === 'all' ? '' : 'secondary'}" data-filter="all">${t('All questions ({n})', { n: r.questions.length })}</button><button class="btn small ${IMP.filter === 'marked' ? '' : 'secondary'}" data-filter="marked">${t('Only marked ({n})', { n: nMarked })}</button></div>
    ${!r.questions.length ? `<p class="empty">${t('This booklet has no questions left.')}</p>` : !groups.length ? `<p class="empty">${t('Nothing marked in this booklet.')}</p>`
      : groups.map(g => `<h2 class="bgroup">${esc(sl(g.subject))} · ${esc(g.topic)}</h2>` + g.qs.map(card).join('')).join('')}`;
  $('#back').onclick = () => importScreen();
  app.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { IMP.filter = b.dataset.filter; bookletView(batch); });
  app.querySelectorAll('.bq').forEach(row => { const id = row.dataset.id, q = r.questions.find(x => x.id === id);
    row.querySelector('[data-a=del]').onclick = async () => { if (confirm(t('Remove this question? Students will no longer see it, but past results are kept.'))) { await api('/admin/questions/' + id, { method: 'DELETE', body: {} }); bookletView(batch); } };
    const ok = row.querySelector('[data-a=ok]'); if (ok) ok.onclick = async () => { await api(`/admin/questions/${id}/checked`, { body: {} }); bookletView(batch); };
    row.querySelector('[data-a=edit]').onclick = () => { row.innerHTML = qForm(q); wireForm(row, async d => { await api('/admin/questions/' + id, { method: 'PATCH', body: d }); bookletView(batch); }, () => bookletView(batch)); }; });
}
```

Notes for the implementer:
- `importScreen` is also called as `cur()` (language toggle) and from the nav with no argument. The `typeof err === 'string'` check stops a click event being shown as an error.
- `qForm`/`wireForm` already exist (question bank section) and post the same fields `PATCH /api/admin/questions/:id` expects. Errors appear in the form's `.err` element.

- [ ] **Step 4: Add the Chinese strings**

In `public/i18n.js`, delete the entries that are no longer used: `'Review ({n})'`, `'Check each question and answer. Flagged items need your attention. Approved questions are available to students immediately.'`, `'Approve all ({n}); incomplete ones are skipped'`, `'Approve'`, `'Reject'`, `'No questions are waiting for review.'`, `'Approved {n}.'`, `' {n} skipped; fix their answers or options first.'`, `'{f}: {n} questions found.'`. Before deleting each one, search `public/app.js` and confirm it no longer appears.

Then add these entries inside `window.ZH = { ... }` next to the other import strings:

```js
  'Drop a PDF or page photos. Only the questions are kept, and they go live for students straight away. Read over them below and fix anything that needs it.': '拖入 PDF 或页面照片。系统只保留题目,并立即向学生开放。请在下方检查并修正需要调整的题目。',
  'Imported booklets': '已导入的讲义', 'No booklets imported yet.': '还没有导入任何讲义。', '{n} to check': '{n} 道待检查', 'Open': '打开', 'Earlier import': '早前导入',
  'Imported booklet': '已导入讲义', 'All booklets': '全部讲义',
  'These questions are live for students. Read over them and fix anything that needs it.': '这些题目已向学生开放。请检查并修正需要调整的地方。',
  'All questions ({n})': '全部题目({n})', 'Only marked ({n})': '仅看带标记的({n})', 'Incomplete: hidden from students until fixed': '不完整:修正前不向学生显示',
  'Answer': '答案', 'Answer is correct': '答案无误', 'Remove': '移除',
  'Remove this question? Students will no longer see it, but past results are kept.': '要移除这道题吗?学生将不再看到它,但以往的答题记录会保留。',
  'Nothing marked in this booklet.': '这份讲义没有带标记的题目。', 'This booklet has no questions left.': '这份讲义已没有题目。',
  '{n} questions added. They are live for students now.': '已添加 {n} 道题,学生现在即可练习。', '{n} are incomplete and hidden from students until you fix them.': '其中 {n} 道不完整,修正前不会向学生显示。',
  'No questions were found in this file.': '这个文件中没有找到题目。',
  'AI extraction needs ANTHROPIC_API_KEY set on the server.': '服务器需要设置 ANTHROPIC_API_KEY 才能使用 AI 提取题目。',
  'Could not read the AI response. Try a smaller file or fewer pages.': '无法读取 AI 的回复。请尝试更小的文件或更少的页数。',
  'File too large (max 30 MB). Split the booklet into smaller parts.': '文件太大(最大 30 MB)。请把讲义拆分成几部分上传。',
```

If a key already exists (for example `'Answer'` or `'Remove'`), keep the existing entry and do not add a duplicate.

- [ ] **Step 5: Add the booklet view styles**

Append to `public/styles.css`:

```css
/* booklet import: booklet list and read-over view */
.blist .brow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.blist .brow:first-of-type{border-top:0}
.bact{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.seg{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 18px}
.bgroup{margin:26px 0 10px;font-size:1.05rem}
.bq .qtext{white-space:pre-wrap;margin:10px 0;font-size:1rem;line-height:1.5}
.bq ol.bopts{margin:0 0 10px;padding-left:24px}
.bq ol.bopts li{padding:3px 8px;border-radius:6px;margin:2px 0}
.bq ol.bopts li.right{background:var(--good-l);color:var(--good);font-weight:600}
.bq .bans{margin-bottom:8px}
.bq .bact{margin-top:12px}
@media (max-width:600px){.blist .brow{flex-direction:column;align-items:flex-start}}
```

(`--line`, `--good`, `--good-l` are existing variables in `styles.css`; check they exist and use the nearest existing ones if not.)

- [ ] **Step 6: Run the tests and syntax check**

Run: `npm test`
Expected: PASS (all test files).
Run: `node --check public/app.js` → no output.

- [ ] **Step 7: Check it in the browser with the fake Claude API**

1. Terminal 1: `node test/fake-claude.js`
2. Terminal 2 (bash): `DB_FILE=/tmp/uplus-try.db ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:4999 npm start` (PowerShell: set each with `$env:NAME='value'` first, using a temp folder path for `DB_FILE`).
3. Open http://localhost:3000, sign in as `admin@uplus.test` / `admin123`, then go to **Import**.
4. Drop any small PDF or PNG. Expected: you land on the booklet page with the note "4 questions added… 1 are incomplete…". The questions are grouped "Maths · Fractions" and "Maths · Area". The MC correct option is highlighted green. Markers show: AI answer on Q2, diagram on Q3, incomplete on Q4.
5. Click **Only marked (3)**: only the three marked questions show. Click **Answer is correct** on Q2: its marker disappears. Click **Edit** on Q4, add the option `A 4×4 square`, save: the incomplete marker disappears.
6. Click **Remove** on Q1 and confirm: it disappears, and the count drops to 3.
7. **← All booklets**: the booklet shows with its count and "to check" tag. Switch to **中文**: every new label is Chinese.
8. Sign in as `parent@uplus.test` / `parent123` (Mia is Year 5). Imported questions only appear for the year group you chose on upload, so upload with year `Year 5` to see them in Practice → Maths.
9. Delete the temporary DB file afterwards.

- [ ] **Step 8: Commit**

```bash
git add public/app.js public/i18n.js public/styles.css test/i18n.test.js
git commit -m "Import screen: booklet list and read-over-and-edit view, no approval step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Everything inside UPlus Ascend; Claude only | 1 (extract unchanged provider), 3 |
| Accepted uploads PDF/PNG/JPEG, size limit | 3 (route unchanged) |
| No approval stage, questions live immediately | 2 (`saveImport`), 3 (routes), 4 (UI) |
| Read-over list: grouped by booklet, then subject/topic, booklet order, page shown | 2 (`getImport` order), 4 (`bookletView`) |
| Shown as students see it, correct answer highlighted, explanation | 4 |
| Markers visible + "only marked" filter | 2 (`imp`, `listImports.marked`), 4 |
| Edit in place, Save/Cancel, live immediately | 3 (`mergeEdit` in `store`), 4 |
| Remove; past results kept | 3 (existing DELETE archives), 4 |
| Earlier imports reachable | 2 (`listImports`), 4 (`importScreen` list) |
| Extraction rules: skip teaching content, worked examples, answer keys, duplicates; keep wording; AI-answer and diagram markers | 1 |
| Errors in plain language, nothing half-added | 2 (transaction), 3 (empty file → 400, nothing saved) |
| English and Chinese | 4 (i18n test + strings) |
| Old review queue migrated | 2 (`migrateDrafts`), 3 (called at startup) |
| Incomplete extractions don't reach students (decision made while planning) | 2 (`needsFix`), 3 (`loadQuestions`) |
| Acceptance checks | 3 (end-to-end test), 4 (browser check) |

One decision was added while planning, consistent with the spec's "no approval" rule. Questions Claude returns incomplete (no answer, or a multiple-choice answer that doesn't match any option) are saved and shown to the admin with a red "Incomplete" marker. They stay hidden from students until fixed, because showing a question with no valid answer would break Practice and Flashcard blitz.
