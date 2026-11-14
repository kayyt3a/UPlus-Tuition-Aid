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
