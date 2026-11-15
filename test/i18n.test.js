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
