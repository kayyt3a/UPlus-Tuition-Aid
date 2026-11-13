const db = require('./db');
const dayStr = d => new Date(d).toISOString().slice(0, 10);
// All heavy work is done by SQLite aggregates, so cost stays small even after years of history.
module.exports = (childId, QMAP) => {
  const tot = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(correct),0) r, AVG(CASE WHEN ms>0 AND ms<300000 THEN ms END) a FROM attempts WHERE child_id=?').get(childId);
  const days = {}; db.prepare('SELECT day, COUNT(*) n FROM attempts WHERE child_id=? GROUP BY day').all(childId).forEach(r => days[r.day] = r.n);
  const today = dayStr(Date.now()), weekAgo = dayStr(Date.now() - 6 * 864e5);
  const last14 = []; for (let i = 13; i >= 0; i--) { const d = dayStr(Date.now() - i * 864e5); last14.push({ day: d, n: days[d] || 0 }); }
  let streak = 0, i = days[today] ? 0 : 1; while (days[dayStr(Date.now() - i * 864e5)]) { streak++; i++; }
  const topics = {};
  db.prepare('SELECT qid, COUNT(*) n, SUM(correct) r FROM attempts WHERE child_id=? GROUP BY qid').all(childId).forEach(r => { const q = QMAP[r.qid]; if (!q) return;
    const k = `${q.subject}|${q.topic}`, t = topics[k] ||= { subject: q.subject, topic: q.topic, n: 0, right: 0 }; t.n += r.n; t.right += r.r; });
  const mocks = db.prepare('SELECT id,year,total,limit_s,started,finished,score FROM mocks WHERE child_id=? AND finished IS NOT NULL ORDER BY finished').all(childId);
  const activeDays = Object.keys(days).length;
  return { total: tot.n, right: tot.r, accuracy: tot.n ? Math.round(tot.r / tot.n * 100) : 0, avgSecs: tot.a ? Math.round(tot.a / 1000 * 10) / 10 : 0,
    today: days[today] || 0, week: Object.entries(days).reduce((a, [d, n]) => a + (d >= weekAgo ? n : 0), 0), activeDays, streak, last14,
    xp: tot.r * 10 + activeDays * 20, topics: Object.values(topics).sort((a, b) => a.right / a.n - b.right / b.n), mocks };
};
