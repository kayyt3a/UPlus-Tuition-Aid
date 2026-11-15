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
