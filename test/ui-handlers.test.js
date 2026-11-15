const { test } = require('node:test');
const assert = require('node:assert/strict');
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');

// An on* handler property whose arrow function returns false cancels the event.
// For key handlers that means typed characters never appear in the box.
test('key handlers use a block body so they never cancel typing', () => {
  const bad = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\.onkey(down|press|up)\s*=\s*\w+\s*=>\s*[^{\s]/.test(l));
  assert.deepEqual(bad, []);
});
