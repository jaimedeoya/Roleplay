import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

let db;

export function initDb(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(student_id, scenario_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

    CREATE TABLE IF NOT EXISTS objectives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      objective_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      evidence TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, objective_key),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      score INTEGER,
      feedback_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

function now() {
  return new Date().toISOString().replace('T', ' ').replace(/\..+$/, '');
}

export function findSession(studentId, scenarioId) {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE student_id = ? AND scenario_id = ?')
    .get(studentId, scenarioId);
}

export function getSessionById(id) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function createSession({ id, studentId, scenarioId }) {
  getDb()
    .prepare(
      'INSERT INTO sessions (id, student_id, scenario_id) VALUES (?, ?, ?)'
    )
    .run(id, studentId, scenarioId);
  return getSessionById(id);
}

export function updateSessionStatus(id, status) {
  getDb()
    .prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, now(), id);
}

export function setSessionSummary(id, summary) {
  getDb()
    .prepare('UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?')
    .run(summary, now(), id);
}

export function listMessages(sessionId) {
  return getDb()
    .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId);
}

export function addMessage(sessionId, role, content) {
  const info = getDb()
    .prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)')
    .run(sessionId, role, content);
  getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
  return info.lastInsertRowid;
}

export function deleteLastAssistantMessage(sessionId) {
  const row = getDb()
    .prepare("SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1")
    .get(sessionId);
  if (!row) return 0;
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(row.id);
  return row.id;
}

export function deleteMessagesFromId(sessionId, fromId) {
  return getDb()
    .prepare('DELETE FROM messages WHERE session_id = ? AND id >= ?')
    .run(sessionId, fromId).changes;
}

export function listObjectives(sessionId) {
  return getDb()
    .prepare('SELECT objective_key, status, evidence, updated_at FROM objectives WHERE session_id = ?')
    .all(sessionId);
}

export function upsertObjective(sessionId, key, status, evidence) {
  getDb()
    .prepare(
      `INSERT INTO objectives (session_id, objective_key, status, evidence, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, objective_key) DO UPDATE SET
         status = excluded.status,
         evidence = excluded.evidence,
         updated_at = excluded.updated_at`
    )
    .run(sessionId, key, status, evidence ?? null, now());
}

export function seedObjectives(sessionId, keys) {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO objectives (session_id, objective_key, status) VALUES (?, ?, 'pending')`
  );
  const tx = getDb().transaction((arr) => {
    for (const k of arr) stmt.run(sessionId, k);
  });
  tx(keys);
}

export function saveEvaluation(sessionId, score, feedback) {
  getDb()
    .prepare(
      `INSERT INTO evaluations (session_id, score, feedback_json) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         score = excluded.score,
         feedback_json = excluded.feedback_json,
         created_at = datetime('now')`
    )
    .run(sessionId, score, JSON.stringify(feedback));
}

export function getEvaluation(sessionId) {
  const row = getDb()
    .prepare('SELECT score, feedback_json, created_at FROM evaluations WHERE session_id = ?')
    .get(sessionId);
  if (!row) return null;
  return { score: row.score, feedback: JSON.parse(row.feedback_json), created_at: row.created_at };
}
