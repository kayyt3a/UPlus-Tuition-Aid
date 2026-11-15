const { test } = require('node:test');
const assert = require('node:assert/strict');
global.window = global.window || {}; require('../public/maths.js'); const fm = window.fmtMaths;
const F = (n, d) => `<span class="frac"><span class="num">${n}</span><span class="sl">/</span><span class="den">${d}</span></span>`;

test('a typed fraction becomes a stacked fraction', () => {
  assert.equal(fm('What is 5/8 of 40?'), `What is ${F(5, 8)} of 40?`);
  assert.equal(fm('1/2 + 1/4'), `${F(1, 2)} + ${F(1, 4)}`);
});

test('mixed numbers keep the whole number next to the fraction', () => {
  assert.equal(fm('Write 2 3/4 as an improper fraction.'), `Write <span class="mixed">2${F(3, 4)}</span> as an improper fraction.`);
});

test('dates, decimals and words with slashes are left alone', () => {
  for (const s of ['Due 12/05/2024', 'Speed in km/h', 'and/or', '2.5/3', '1/2/3']) assert.equal(fm(s), s.replace('&', '&amp;'));
});

test('unicode fraction characters are shown the same way', () => {
  assert.equal(fm('¾ of 12'), `${F(3, 4)} of 12`);
  assert.equal(fm('2½ cups'), `<span class="mixed">2${F(1, 2)}</span> cups`);
});

test('text is still HTML-escaped', () => {
  assert.equal(fm('<b>1/2</b> & "x"'), `&lt;b&gt;${F(1, 2)}&lt;/b&gt; &amp; &quot;x&quot;`);
  assert.equal(fm(null), '');
});
