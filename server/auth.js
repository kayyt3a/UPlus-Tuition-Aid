const crypto = require('crypto'), { promisify } = require('util');
const db = require('./db');
const scrypt = promisify(crypto.scrypt); // runs on the libuv thread pool, so logins never freeze other students
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const ins = (email, name, salt, hash, role, paidUntil) => db.prepare('INSERT INTO users(email,name,salt,hash,role,paid_until) VALUES(?,?,?,?,?,?)').run(email.toLowerCase().trim(), name.trim(), salt, hash, role, paidUntil).lastInsertRowid;
exports.createUser = async (email, name, pw, role = 'parent', paidUntil = null) => { const salt = crypto.randomBytes(16).toString('hex'); return ins(email, name, salt, (await scrypt(pw, salt, 32)).toString('hex'), role, paidUntil); };
exports.createUserSync = (email, name, pw, role = 'parent', paidUntil = null) => { const salt = crypto.randomBytes(16).toString('hex'); return ins(email, name, salt, crypto.scryptSync(pw, salt, 32).toString('hex'), role, paidUntil); };
exports.checkLogin = async (email, pw) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase().trim());
  const h = (await scrypt(String(pw), u ? u.salt : DUMMY_SALT, 32)); // same work whether or not the account exists
  return u && crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex')) ? u : null;
};
exports.newSession = uid => { const t = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t, uid, Date.now() + 30 * 864e5); return t; };
exports.userFromCookie = cookie => {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(cookie || ''); if (!m) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.exp>?').get(m[1], Date.now()) || null;
};
exports.endSession = cookie => { const m = /sid=([a-f0-9]+)/.exec(cookie || ''); if (m) db.prepare('DELETE FROM sessions WHERE token=?').run(m[1]); };
exports.purgeSessions = () => db.prepare('DELETE FROM sessions WHERE exp<?').run(Date.now());
exports.isPaid = u => u.role === 'admin' || (u.paid_until && u.paid_until >= new Date().toISOString().slice(0, 10))
  || (new Date(u.created).getTime() + 7 * 864e5 >= Date.now()); // 7-day free trial
