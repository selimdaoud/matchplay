const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_FILE = path.join(__dirname, 'scores.db');
const JSON_FILE = path.join(__dirname, 'scores.json');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    date      TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id              TEXT PRIMARY KEY,
    tournamentId    TEXT NOT NULL REFERENCES tournaments(id),
    title           TEXT NOT NULL DEFAULT '',
    referencePlayer TEXT NOT NULL DEFAULT '',
    opponent        TEXT NOT NULL DEFAULT '',
    createdAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holes (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    matchId  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    hole     INTEGER NOT NULL,
    result   TEXT NOT NULL CHECK(result IN ('win', 'halve', 'loss')),
    playedAt TEXT NOT NULL,
    UNIQUE(matchId, hole)
  );
`);

const stmts = {
  getLatestTournament: db.prepare('SELECT * FROM tournaments ORDER BY date DESC, rowid DESC LIMIT 1'),
  insertTournament:    db.prepare('INSERT INTO tournaments (id, name, date, updatedAt) VALUES (?, ?, ?, ?)'),
  getTournament:       db.prepare('SELECT * FROM tournaments WHERE id = ?'),
  updateTournamentTs:  db.prepare('UPDATE tournaments SET updatedAt = ? WHERE id = ?'),
  getMatches:          db.prepare('SELECT id, title, referencePlayer, opponent FROM matches WHERE tournamentId = ? ORDER BY createdAt'),
  getHoles:            db.prepare('SELECT hole, result, playedAt FROM holes WHERE matchId = ? ORDER BY hole'),
  upsertMatch:         db.prepare(`
    INSERT INTO matches (id, tournamentId, title, referencePlayer, opponent, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title           = excluded.title,
      referencePlayer = excluded.referencePlayer,
      opponent        = excluded.opponent
  `),
  upsertHole: db.prepare(`
    INSERT INTO holes (matchId, hole, result, playedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(matchId, hole) DO UPDATE SET
      result   = excluded.result,
      playedAt = CASE WHEN result = excluded.result THEN playedAt ELSE excluded.playedAt END
  `),
  deleteOrphanHoles: db.prepare('DELETE FROM holes WHERE matchId = ? AND hole NOT IN (SELECT value FROM json_each(?))'),
  deleteAllHoles:    db.prepare('DELETE FROM holes WHERE matchId = ?'),
};

function getOrCreateTournament() {
  const existing = stmts.getLatestTournament.get();
  if (existing) return existing;
  const id = `tournament-${Date.now()}`;
  const now = new Date().toISOString();
  stmts.insertTournament.run(id, 'Tournoi', now.slice(0, 10), now);
  return stmts.getTournament.get(id);
}

function readState() {
  const tournament = getOrCreateTournament();
  const matches = stmts.getMatches.all(tournament.id);
  for (const match of matches) {
    match.holes = stmts.getHoles.all(match.id);
  }
  return { matches, updatedAt: tournament.updatedAt };
}

const syncState = db.transaction((matches) => {
  const tournament = getOrCreateTournament();
  const now = new Date().toISOString();

  for (const match of matches) {
    stmts.upsertMatch.run(match.id, tournament.id, match.title || '', match.referencePlayer || '', match.opponent || '', now);

    const holeNumbers = match.holes.map((h) => h.hole);
    if (holeNumbers.length > 0) {
      stmts.deleteOrphanHoles.run(match.id, JSON.stringify(holeNumbers));
      for (const h of match.holes) {
        stmts.upsertHole.run(match.id, h.hole, h.result, now);
      }
    } else {
      stmts.deleteAllHoles.run(match.id);
    }
  }

  stmts.updateTournamentTs.run(now, tournament.id);
  return readState();
});

function writeState(matches) {
  return syncState(matches);
}

function importJsonIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM tournaments').get().n;
  if (count > 0 || !fs.existsSync(JSON_FILE)) return;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  } catch {
    return;
  }
  if (!Array.isArray(data.matches)) return;

  const now = new Date().toISOString();
  stmts.insertTournament.run('tournament-import', 'Import initial', now.slice(0, 10), data.updatedAt || now);

  for (let i = 0; i < data.matches.length; i++) {
    const m = data.matches[i];
    const matchId = m.id || `match-${i + 1}`;
    stmts.upsertMatch.run(matchId, 'tournament-import', m.title || `Match ${i + 1}`, m.referencePlayer || '', m.opponent || '', now);
    for (const h of (m.holes || [])) {
      if (Number.isInteger(h.hole) && ['win', 'halve', 'loss'].includes(h.result)) {
        stmts.upsertHole.run(matchId, h.hole, h.result, now);
      }
    }
  }

  fs.renameSync(JSON_FILE, `${JSON_FILE}.bak`);
  console.log('[db] Imported scores.json → scores.db (backup: scores.json.bak)');
}

importJsonIfNeeded();

module.exports = { readState, writeState };
