const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, '..', 'uplus.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'parent', paid_until TEXT, created TEXT NOT NULL DEFAULT (date('now')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS children(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, year TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY, child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  qid TEXT NOT NULL, correct INTEGER NOT NULL, ms INTEGER, mode TEXT, mock_id INTEGER, day TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_att_child ON attempts(child_id, day);
CREATE TABLE IF NOT EXISTS mocks(id INTEGER PRIMARY KEY, child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  year TEXT, total INTEGER, limit_s INTEGER, started INTEGER, finished INTEGER, score INTEGER, qids TEXT);
`);
module.exports = db;
