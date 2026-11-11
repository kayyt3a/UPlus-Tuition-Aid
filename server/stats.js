const db = require('./db');
const dayStr = d => new Date(d).toISOString().slice(0, 10);
module.exports = (childId, QMAP) => {
  const rows = db.prepare('SELECT qid,correct,ms,day,mock_id FROM attempts WHERE child_id=? ORDER BY ts').all(childId);
  const today = dayStr(Date.now());
  const total = rows.length, right = rows.filter(r => r.correct).length;
  const timed = rows.filter(r => r.ms > 0 && r.ms < 300000);
  const days = {}; rows.forEach(r => days[r.day] = (days[r.day] || 0) + 1);
  const last14 = []; for (let i = 13; i >= 0; i--) { const d = dayStr(Date.now() - i * 864e5); last14.push({ day: d, n: days[d] || 0 }); }
  let streak = 0, i = days[today] ? 0 : 1;
  while (days[dayStr(Date.now() - i * 864e5)]) { streak++; i++; }
  const weekAgo = dayStr(Date.now() - 6 * 864e5);
  const topics = {};
  rows.forEach(r => { const q = QMAP[r.qid]; if (!q) return; const k = `${q.subject}|${q.topic}`; const t = topics[k] ||= { subject: q.subject, topic: q.topic, n: 0, right: 0 };
    t.n++; t.right += r.correct; });
  const mocks = db.prepare('SELECT id,year,total,limit_s,started,finished,score FROM mocks WHERE child_id=? AND finished IS NOT NULL ORDER BY finished').all(childId);
  return { total, right, accuracy: total ? Math.round(right / total * 100) : 0,
    avgSecs: timed.length ? Math.round(timed.reduce((a, r) => a + r.ms, 0) / timed.length / 1000 * 10) / 10 : 0,
    today: days[today] || 0, week: rows.filter(r => r.day >= weekAgo).length, activeDays: Object.keys(days).length, streak, last14,
    xp: right * 10 + Object.keys(days).length * 20,
    topics: Object.values(topics).sort((a, b) => a.right / a.n - b.right / b.n), mocks };
};
