import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

let db;

export function initDb(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new DatabaseSync(resolved, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      provider TEXT,
      model TEXT,
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
      session_id TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      score INTEGER,
      feedback_json TEXT NOT NULL,
      narrative TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, attempt),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  // Lightweight migrations for older DBs created before these columns existed.
  const cols = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((r) => r.name));
  if (!cols.has('model')) db.exec(`ALTER TABLE sessions ADD COLUMN model TEXT`);
  if (!cols.has('provider')) db.exec(`ALTER TABLE sessions ADD COLUMN provider TEXT`);
  if (!cols.has('difficulty')) db.exec(`ALTER TABLE sessions ADD COLUMN difficulty TEXT`);
  if (!cols.has('variant')) db.exec(`ALTER TABLE sessions ADD COLUMN variant TEXT`);
  if (!cols.has('attempt')) db.exec(`ALTER TABLE sessions ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1`);
  if (!cols.has('notes')) db.exec(`ALTER TABLE sessions ADD COLUMN notes TEXT`);

  const mcols = new Set(db.prepare('PRAGMA table_info(messages)').all().map((r) => r.name));
  if (!mcols.has('feedback')) db.exec(`ALTER TABLE messages ADD COLUMN feedback TEXT`);

  // Evaluations: old schema used UNIQUE(session_id). Rebuild to allow multiple
  // attempts per session so we can keep history + personal best.
  const evalIdxs = db.prepare('PRAGMA index_list(evaluations)').all();
  const hasOldUnique = evalIdxs.some((ix) => {
    if (!ix.unique) return false;
    const icols = db.prepare(`PRAGMA index_info("${ix.name}")`).all();
    return icols.length === 1 && icols[0].name === 'session_id';
  });
  const ecols = new Set(db.prepare('PRAGMA table_info(evaluations)').all().map((r) => r.name));
  if (hasOldUnique || !ecols.has('attempt') || !ecols.has('narrative')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evaluations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        score INTEGER,
        feedback_json TEXT NOT NULL,
        narrative TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, attempt),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      INSERT INTO evaluations_new (id, session_id, attempt, score, feedback_json, narrative, created_at)
        SELECT id, session_id, 1, score, feedback_json, NULL, created_at FROM evaluations;
      DROP TABLE evaluations;
      ALTER TABLE evaluations_new RENAME TO evaluations;
    `);
  }

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

export function createSession({ id, studentId, scenarioId, provider, model, difficulty }) {
  getDb()
    .prepare(
      'INSERT INTO sessions (id, student_id, scenario_id, provider, model, difficulty) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, studentId, scenarioId, provider ?? null, model ?? null, difficulty ?? null);
  return getSessionById(id);
}

export function setSessionDifficulty(id, difficulty) {
  getDb()
    .prepare('UPDATE sessions SET difficulty = ?, updated_at = ? WHERE id = ?')
    .run(difficulty ?? null, now(), id);
}

export function setSessionVariant(id, variant) {
  getDb()
    .prepare('UPDATE sessions SET variant = ?, updated_at = ? WHERE id = ?')
    .run(variant ?? null, now(), id);
}

export function setSessionNotes(id, notes) {
  getDb()
    .prepare('UPDATE sessions SET notes = ?, updated_at = ? WHERE id = ?')
    .run(notes ?? null, now(), id);
}

export function bumpSessionAttempt(id) {
  getDb()
    .prepare(
      'UPDATE sessions SET attempt = attempt + 1, updated_at = ? WHERE id = ?'
    )
    .run(now(), id);
  return getSessionById(id).attempt;
}

export function listSessionsForStudent(studentId) {
  return getDb()
    .prepare(
      `SELECT s.*, (
         SELECT COUNT(*) FROM evaluations e WHERE e.session_id = s.id
       ) AS attempts_completed,
       (SELECT MAX(score) FROM evaluations e WHERE e.session_id = s.id) AS best_score,
       (SELECT score FROM evaluations e WHERE e.session_id = s.id
          ORDER BY attempt DESC LIMIT 1) AS last_score
       FROM sessions s WHERE s.student_id = ? ORDER BY s.updated_at DESC`
    )
    .all(studentId);
}

export function setSessionModel(id, provider, model) {
  getDb()
    .prepare('UPDATE sessions SET provider = ?, model = ?, updated_at = ? WHERE id = ?')
    .run(provider ?? null, model ?? null, now(), id);
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
    .prepare(
      'SELECT id, role, content, feedback, created_at FROM messages WHERE session_id = ? ORDER BY id ASC'
    )
    .all(sessionId)
    .map((m) => ({ ...m, feedback: m.feedback ? safeParse(m.feedback) : null }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export function addMessage(sessionId, role, content) {
  const info = getDb()
    .prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)')
    .run(sessionId, role, content);
  getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
  return info.lastInsertRowid;
}

export function setMessageFeedback(messageId, feedback) {
  getDb()
    .prepare('UPDATE messages SET feedback = ? WHERE id = ?')
    .run(feedback ? JSON.stringify(feedback) : null, messageId);
}

export function getLastUserMessage(sessionId) {
  return getDb()
    .prepare(
      "SELECT id, content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1"
    )
    .get(sessionId);
}

export function deleteLastAssistantMessage(sessionId) {
  const row = getDb()
    .prepare("SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1")
    .get(sessionId);
  if (!row) return 0;
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(row.id);
  return row.id;
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
  const d = getDb();
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO objectives (session_id, objective_key, status) VALUES (?, ?, 'pending')`
  );
  d.exec('BEGIN');
  try {
    for (const k of keys) stmt.run(sessionId, k);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Start a new attempt: wipe messages, objectives, summary and notes for the
 * session while PRESERVING past evaluations (we want history + personal best).
 * Increments `attempt`, sets status back to 'active'. Variant is cleared —
 * the caller decides whether to assign a new one.
 */
export function resetSession(sessionId) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    d.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    d.prepare('DELETE FROM objectives WHERE session_id = ?').run(sessionId);
    d.prepare(
      `UPDATE sessions
         SET summary = NULL,
             status = 'active',
             notes = NULL,
             variant = NULL,
             attempt = attempt + 1,
             updated_at = ?
       WHERE id = ?`
    ).run(now(), sessionId);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function saveEvaluation(sessionId, attempt, score, feedback, narrative = null) {
  getDb()
    .prepare(
      `INSERT INTO evaluations (session_id, attempt, score, feedback_json, narrative)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, attempt) DO UPDATE SET
         score = excluded.score,
         feedback_json = excluded.feedback_json,
         narrative = excluded.narrative,
         created_at = datetime('now')`
    )
    .run(sessionId, attempt, score, JSON.stringify(feedback), narrative);
}

export function getEvaluation(sessionId, attempt = null) {
  const q = attempt == null
    ? `SELECT attempt, score, feedback_json, narrative, created_at
         FROM evaluations WHERE session_id = ? ORDER BY attempt DESC LIMIT 1`
    : `SELECT attempt, score, feedback_json, narrative, created_at
         FROM evaluations WHERE session_id = ? AND attempt = ?`;
  const row = attempt == null
    ? getDb().prepare(q).get(sessionId)
    : getDb().prepare(q).get(sessionId, attempt);
  if (!row) return null;
  return {
    attempt: row.attempt,
    score: row.score,
    feedback: JSON.parse(row.feedback_json),
    narrative: row.narrative || null,
    created_at: row.created_at,
  };
}

export function listEvaluations(sessionId) {
  return getDb()
    .prepare(
      `SELECT attempt, score, narrative, created_at
         FROM evaluations WHERE session_id = ? ORDER BY attempt ASC`
    )
    .all(sessionId);
}

export function getPersonalBest(sessionId) {
  const row = getDb()
    .prepare('SELECT MAX(score) AS best FROM evaluations WHERE session_id = ?')
    .get(sessionId);
  return row?.best ?? null;
}
