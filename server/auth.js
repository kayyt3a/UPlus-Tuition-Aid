const crypto = require('crypto');
const db = require('./db');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
exports.createUser = (email, name, pw, role = 'parent', paidUntil = null) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return db.prepare('INSERT INTO users(email,name,salt,hash,role,paid_until) VALUES(?,?,?,?,?,?)')
    .run(email.toLowerCase().trim(), name.trim(), salt, hash(pw, salt), role, paidUntil).lastInsertRowid;
};
exports.checkLogin = (email, pw) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase().trim());
  if (!u) return null;
  const a = Buffer.from(hash(pw, u.salt)), b = Buffer.from(u.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? u : null;
};
exports.newSession = uid => { const t = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t, uid, Date.now() + 30 * 864e5); return t; };
exports.userFromCookie = cookie => {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(cookie || ''); if (!m) return null;
  const r = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.exp>?').get(m[1], Date.now());
  return r || null;
};
exports.endSession = cookie => { const m = /sid=([a-f0-9]+)/.exec(cookie || ''); if (m) db.prepare('DELETE FROM sessions WHERE token=?').run(m[1]); };
exports.isPaid = u => u.role === 'admin' || (u.paid_until && u.paid_until >= new Date().toISOString().slice(0, 10))
  || (new Date(u.created).getTime() + 7 * 864e5 >= Date.now()); // 7-day free trial
