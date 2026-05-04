#!/usr/bin/env node
'use strict';

const readline = require('readline');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'scores.db'));
db.pragma('foreign_keys = ON');

function listSessions() {
  return db.prepare('SELECT * FROM sessions ORDER BY date DESC, rowid DESC').all();
}

function sessionSummary(session) {
  const matchCount = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE sessionId = ?').get(session.id).n;
  const holeCount = db.prepare('SELECT COUNT(*) AS n FROM holes WHERE matchId IN (SELECT id FROM matches WHERE sessionId = ?)').get(session.id).n;
  return { matchCount, holeCount };
}

const resetSession = db.transaction((sessionId) => {
  db.prepare('DELETE FROM holes WHERE matchId IN (SELECT id FROM matches WHERE sessionId = ?)').run(sessionId);
  db.prepare('DELETE FROM matches WHERE sessionId = ?').run(sessionId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
});

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const sessions = listSessions();

  if (!sessions.length) {
    console.log('Aucune session trouvée dans la base de données.');
    process.exit(0);
  }

  console.log('\n=== RESET SESSION — Matchplay Live ===\n');
  console.log('Sessions disponibles :\n');

  sessions.forEach((s, i) => {
    const { matchCount, holeCount } = sessionSummary(s);
    console.log(`  [${i + 1}] ${s.date}  id: ${s.id}`);
    console.log(`       ${matchCount} match(s), ${holeCount} trou(s) enregistré(s)\n`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let choice;
  if (sessions.length === 1) {
    choice = 1;
    console.log('→ Une seule session, sélectionnée automatiquement.\n');
  } else {
    const answer = await ask(rl, `Numéro de la session à réinitialiser (1-${sessions.length}) : `);
    choice = parseInt(answer, 10);
    if (isNaN(choice) || choice < 1 || choice > sessions.length) {
      console.log('Choix invalide. Abandon.');
      rl.close();
      process.exit(1);
    }
  }

  const session = sessions[choice - 1];
  const { matchCount, holeCount } = sessionSummary(session);

  console.log(`\n⚠️  ATTENTION — Cette opération est irréversible.\n`);
  console.log(`  Session : ${session.date} (${session.id})`);
  console.log(`  Suppression : ${matchCount} match(s) + ${holeCount} entrée(s) audit\n`);

  const confirm = await ask(rl, 'Confirmer ? Tapez "oui" pour continuer : ');
  rl.close();

  if (confirm.trim().toLowerCase() !== 'oui') {
    console.log('\nAbandon. Aucune donnée supprimée.');
    process.exit(0);
  }

  resetSession(session.id);
  console.log('\n✓ Session réinitialisée. Toutes les données ont été supprimées.');
}

main().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
