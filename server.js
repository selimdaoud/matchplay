const express = require('express');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH || '/matchplay').replace(/\/$/, '');

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function checkSessionCode(provided) {
  const expected = process.env.SESSION_CODE;
  if (!expected) return true;
  if (!provided) return false;
  try {
    const a = Buffer.from(provided.padEnd(32).slice(0, 32));
    const b = Buffer.from(expected.padEnd(32).slice(0, 32));
    return crypto.timingSafeEqual(a, b) && provided === expected;
  } catch {
    return false;
  }
}

// ── Match creation ────────────────────────────────────────────────────────────

app.get('/new', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'new.html'));
});

app.post('/new', async (req, res) => {
  try {
    const { code, title, referencePlayer, opponent } = req.body || {};
    if (!checkSessionCode(code)) {
      return res.status(401).json({ error: 'Code de session incorrect.' });
    }
    if (!title || !referencePlayer || !opponent) {
      return res.status(400).json({ error: 'Titre, joueur de référence et adversaire sont requis.' });
    }
    const session = db.getActiveSession();
    const match = db.createMatch(session.id, { title, referencePlayer, opponent });
    const recorderUrl = `${req.protocol}://${req.get('host')}${BASE_PATH}/match/${match.token}`;
    const qrDataUrl = await QRCode.toDataURL(recorderUrl);
    res.json({ token: match.token, recorderUrl, qrDataUrl });
  } catch (error) {
    console.error('[POST /new]', error);
    res.status(500).json({ error: 'Impossible de créer le match.' });
  }
});

// ── Recorder ─────────────────────────────────────────────────────────────────

app.get('/match/:token', (req, res) => {
  const match = db.getMatchByToken(req.params.token);
  if (!match) return res.status(404).send('<h1>Match introuvable</h1>');
  res.sendFile(path.join(__dirname, 'public', 'recorder.html'));
});

app.get('/api/match/:token', (req, res) => {
  try {
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    res.json(db.readMatchState(match.id));
  } catch (error) {
    console.error('[GET /api/match/:token]', error);
    res.status(500).json({ error: 'Impossible de charger le match.' });
  }
});

app.put('/api/match/:token', (req, res) => {
  try {
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    const { title, referencePlayer, opponent } = req.body || {};
    res.json(db.updateMatch(match.id, { title, referencePlayer, opponent }));
  } catch (error) {
    console.error('[PUT /api/match/:token]', error);
    res.status(500).json({ error: 'Impossible de mettre à jour le match.' });
  }
});

app.put('/api/match/:token/holes/:hole', (req, res) => {
  try {
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });

    const holeNumber = Number(req.params.hole);
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 99) {
      return res.status(400).json({ error: 'Numéro de trou invalide.' });
    }

    const { result } = req.body || {};
    if (!['win', 'halve', 'loss'].includes(result)) {
      return res.status(400).json({ error: 'Résultat invalide.' });
    }

    res.json(db.setHole(match.id, holeNumber, result));
  } catch (error) {
    console.error('[PUT /api/match/:token/holes/:hole]', error);
    res.status(500).json({ error: 'Impossible de sauvegarder le trou.' });
  }
});

// ── Live feed ─────────────────────────────────────────────────────────────────

app.get(['/live', '/live/:matchId'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live.html'));
});

app.get('/api/live', (_req, res) => {
  try {
    const session = db.getActiveSession();
    const matches = db.readLiveState(session.id);
    res.json({ session: { id: session.id, name: session.name, date: session.date }, matches });
  } catch (error) {
    console.error('[GET /api/live]', error);
    res.status(500).json({ error: 'Impossible de charger le live.' });
  }
});

// ── Audit ─────────────────────────────────────────────────────────────────────

app.get('/api/match/:token/audit', (req, res) => {
  try {
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    res.json({ matchId: match.id, events: db.readAuditLog(match.id) });
  } catch (error) {
    console.error('[GET /api/match/:token/audit]', error);
    res.status(500).json({ error: 'Impossible de charger l\'audit.' });
  }
});

// ── Root ──────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'live.html')));

app.listen(PORT, () => {
  console.log(`Golf matchplay live app running on http://localhost:${PORT}`);
});
