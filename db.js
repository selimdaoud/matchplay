const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const db = new Database(path.join(__dirname, 'scores.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    date      TEXT NOT NULL,
    code      TEXT,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id              TEXT PRIMARY KEY,
    sessionId       TEXT NOT NULL REFERENCES sessions(id),
    token           TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL DEFAULT '',
    referencePlayer TEXT NOT NULL DEFAULT '',
    opponent        TEXT NOT NULL DEFAULT '',
    hidden          INTEGER NOT NULL DEFAULT 0,
    createdAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    matchId      TEXT NOT NULL REFERENCES matches(id),
    hole         INTEGER NOT NULL,
    result       TEXT NOT NULL CHECK(result IN ('win','halve','loss')),
    recordedAt   TEXT NOT NULL,
    supersededBy INTEGER REFERENCES holes(id)
  );
`);

// Migration: add hidden column to existing DBs
const cols = db.prepare('PRAGMA table_info(matches)').all();
if (!cols.find((c) => c.name === 'hidden')) {
  db.exec('ALTER TABLE matches ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
}

const stmts = {
  getLatestSession:      db.prepare('SELECT * FROM sessions ORDER BY date DESC, rowid DESC LIMIT 1'),
  insertSession:         db.prepare('INSERT INTO sessions (id, name, date, code, updatedAt) VALUES (?, ?, ?, ?, ?)'),
  getMatchByToken:       db.prepare('SELECT * FROM matches WHERE token = ?'),
  getMatchById:          db.prepare('SELECT * FROM matches WHERE id = ?'),
  getMatchesBySession:   db.prepare('SELECT id, title, referencePlayer, opponent FROM matches WHERE sessionId = ? AND hidden = 0 ORDER BY createdAt'),
  getAllMatchesBySession: db.prepare('SELECT id, token, title, referencePlayer, opponent, hidden FROM matches WHERE sessionId = ? ORDER BY createdAt'),
  insertMatch:           db.prepare('INSERT INTO matches (id, sessionId, token, title, referencePlayer, opponent, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateMatch:           db.prepare('UPDATE matches SET title = ?, referencePlayer = ?, opponent = ? WHERE id = ?'),
  setHidden:             db.prepare('UPDATE matches SET hidden = ? WHERE id = ?'),
  getCurrentHoles:       db.prepare('SELECT hole, result, recordedAt FROM holes WHERE matchId = ? AND supersededBy IS NULL ORDER BY hole'),
  getAllHoles:            db.prepare('SELECT id, hole, result, recordedAt, supersededBy FROM holes WHERE matchId = ? ORDER BY recordedAt'),
  findCurrentHole:       db.prepare('SELECT id FROM holes WHERE matchId = ? AND hole = ? AND supersededBy IS NULL'),
  insertHole:            db.prepare('INSERT INTO holes (matchId, hole, result, recordedAt) VALUES (?, ?, ?, ?)'),
  supersede:             db.prepare('UPDATE holes SET supersededBy = ? WHERE id = ?'),
};

function getActiveSession() {
  const existing = stmts.getLatestSession.get();
  if (existing) return existing;
  const id = `session-${Date.now()}`;
  const now = new Date().toISOString();
  stmts.insertSession.run(id, 'Session', now.slice(0, 10), null, now);
  return stmts.getLatestSession.get();
}

function createSession(name, code) {
  const id = `session-${Date.now()}`;
  const now = new Date().toISOString();
  stmts.insertSession.run(id, name || 'Session', now.slice(0, 10), code || null, now);
  return stmts.getLatestSession.get();
}

function generateToken() {
  let token;
  do {
    token = crypto.randomBytes(3).toString('hex');
  } while (stmts.getMatchByToken.get(token));
  return token;
}

function createMatch(sessionId, { title, referencePlayer, opponent }) {
  const id = `match-${Date.now()}`;
  const token = generateToken();
  const now = new Date().toISOString();
  stmts.insertMatch.run(id, sessionId, token, title || '', referencePlayer || '', opponent || '', now);
  return stmts.getMatchByToken.get(token);
}

function getMatchByToken(token) {
  return stmts.getMatchByToken.get(token) || null;
}

function updateMatch(matchId, { title, referencePlayer, opponent }) {
  const match = stmts.getMatchById.get(matchId);
  if (!match) return null;
  stmts.updateMatch.run(
    title !== undefined ? title : match.title,
    referencePlayer !== undefined ? referencePlayer : match.referencePlayer,
    opponent !== undefined ? opponent : match.opponent,
    matchId
  );
  return readMatchState(matchId);
}

function setMatchHidden(matchId, hidden) {
  stmts.setHidden.run(hidden ? 1 : 0, matchId);
}

function readMatchState(matchId) {
  const match = stmts.getMatchById.get(matchId);
  if (!match) return null;
  const holes = stmts.getCurrentHoles.all(matchId);
  return { id: match.id, token: match.token, title: match.title, referencePlayer: match.referencePlayer, opponent: match.opponent, holes };
}

const setHole = db.transaction((matchId, holeNumber, result) => {
  const existing = stmts.findCurrentHole.get(matchId, holeNumber);
  const now = new Date().toISOString();
  stmts.insertHole.run(matchId, holeNumber, result, now);
  const newId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  if (existing) stmts.supersede.run(newId, existing.id);
  return readMatchState(matchId);
});

function readLiveState(sessionId) {
  const matches = stmts.getMatchesBySession.all(sessionId);
  for (const match of matches) {
    match.holes = stmts.getCurrentHoles.all(match.id);
  }
  return matches;
}

function getAllMatchesForSession(sessionId) {
  const matches = stmts.getAllMatchesBySession.all(sessionId);
  for (const match of matches) {
    match.holesCount = stmts.getCurrentHoles.all(match.id).length;
  }
  return matches;
}

function readAuditLog(matchId) {
  return stmts.getAllHoles.all(matchId);
}

module.exports = {
  getActiveSession,
  createSession,
  createMatch,
  getMatchByToken,
  updateMatch,
  setMatchHidden,
  readMatchState,
  setHole,
  readLiveState,
  getAllMatchesForSession,
  readAuditLog,
};
