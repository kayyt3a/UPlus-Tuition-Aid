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

test('API failures become plain messages the admin can act on', () => {
  const { friendly } = require('../server/extract');
  assert.match(friendly(401, 'invalid x-api-key'), /key on the server is not valid/);
  assert.match(friendly(529, 'Overloaded'), /busy/);
  assert.match(friendly(429, ''), /busy/);
  assert.match(friendly(400, 'A maximum of 100 PDF pages may be provided.'), /Split the booklet/);
  assert.match(friendly(500, 'internal'), /could not read this file/);
});
