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

test('the admin can move a whole booklet to another year group, then remove it', async () => {
  const admin = await login('admin@uplus.test', 'admin123'), parent = await login('parent@uplus.test', 'parent123');
  replies.push(ITEMS.map(x => ({ ...x, q: x.q.replace('(import test)', '(move test)') })));
  const { batch } = (await upload(admin, 'Wrong year.pdf')).json;
  const childId = (await call(parent, '/api/me')).json.children[0].id;
  const sees = async y => (await call(parent, `/api/questions?childId=${childId}&year=${encodeURIComponent(y)}&subject=Maths&n=40`)).json.questions.filter(q => q.q.includes('(move test)')).length;
  assert.equal(await sees('Year 5'), 2); // one of the three is incomplete and hidden
  const mv = await call(admin, '/api/admin/imports/' + batch, { method: 'PATCH', body: { year: 'Year 6' } });
  assert.equal(mv.status, 200); assert.equal(mv.json.moved, 3);
  assert.equal(await sees('Year 5'), 0); assert.equal(await sees('Year 6'), 2);
  assert.equal((await call(admin, '/api/admin/imports/' + batch)).json.year, 'Year 6');
  const rm = await call(admin, '/api/admin/imports/' + batch, { method: 'DELETE', body: {} });
  assert.equal(rm.status, 200); assert.equal(rm.json.removed, 3);
  assert.equal(await sees('Year 6'), 0);
  assert.equal((await call(admin, '/api/admin/imports/' + batch)).status, 404);
  assert.equal((await call(parent, '/api/admin/imports/' + batch, { method: 'PATCH', body: { year: 'Year 3' } })).status, 403);
});
