const express = require('express');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const db = require('./db');
const courses = require('./courses');

const app = express();
const PORT = process.env.PORT || 3000;
const configuredBasePath = process.env.BASE_PATH === undefined ? '/matchplay' : process.env.BASE_PATH;
const BASE_PATH = configuredBasePath.replace(/\/$/, '');

function paths(routePath) {
  if (!BASE_PATH) return [routePath];
  return [routePath, `${BASE_PATH}${routePath}`];
}

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));
if (BASE_PATH) app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));

function checkSessionCode(provided) {
  const expected = process.env.SESSION_CODE;
  if (!expected || !provided) return false;
  try {
    const a = Buffer.from(provided.padEnd(32).slice(0, 32));
    const b = Buffer.from(expected.padEnd(32).slice(0, 32));
    return crypto.timingSafeEqual(a, b) && provided === expected;
  } catch {
    return false;
  }
}

// ── Match creation ────────────────────────────────────────────────────────────

app.get(paths('/new'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'new.html'));
});

app.post(paths('/new'), async (req, res) => {
  try {
    const { code, title, referencePlayer, opponent, type, course, startHole } = req.body || {};
    if (!checkSessionCode(code)) {
      return res.status(401).json({ error: 'Code de session incorrect.' });
    }
    const matchType = type === 'strokeplay' ? 'strokeplay' : 'matchplay';
    const courseId = courses.normalizeCourseId(course || 'none');
    if (!title || !referencePlayer) {
      return res.status(400).json({ error: 'Titre et joueur de référence sont requis.' });
    }
    if (matchType === 'matchplay' && !opponent) {
      return res.status(400).json({ error: 'L\'adversaire est requis pour un match matchplay.' });
    }
    const firstHole = matchType === 'strokeplay' ? Number(startHole || 1) : 1;
    if (!Number.isInteger(firstHole) || firstHole < 1 || firstHole > 18) {
      return res.status(400).json({ error: 'Le trou de départ doit être compris entre 1 et 18.' });
    }
    const session = db.getActiveSession();
    const match = db.createMatch(session.id, { title, referencePlayer, opponent: opponent || '', type: matchType, course: courseId, startHole: firstHole });
    const recorderUrl = `${req.protocol}://${req.get('host')}${BASE_PATH}/match/${match.token}`;
    const qrDataUrl = await QRCode.toDataURL(recorderUrl);
    res.json({ token: match.token, recorderUrl, qrDataUrl });
  } catch (error) {
    console.error('[POST /new]', error);
    res.status(500).json({ error: 'Impossible de créer le match.' });
  }
});

// ── Recorder ─────────────────────────────────────────────────────────────────

app.get(paths('/match/:token'), (req, res) => {
  const match = db.getMatchByToken(req.params.token);
  if (!match) return res.status(404).send('<h1>Match introuvable</h1>');
  res.sendFile(path.join(__dirname, 'public', 'recorder.html'));
});

app.get(paths('/api/match/:token'), (req, res) => {
  try {
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    const state = db.readMatchState(match.id);
    res.json({ ...state, courseData: courses.getCourse(state.course) });
  } catch (error) {
    console.error('[GET /api/match/:token]', error);
    res.status(500).json({ error: 'Impossible de charger le match.' });
  }
});

app.put(paths('/api/match/:token'), (req, res) => {
  try {
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    const { title, referencePlayer, opponent } = req.body || {};
    const state = db.updateMatch(match.id, { title, referencePlayer, opponent });
    res.json({ ...state, courseData: courses.getCourse(state.course) });
  } catch (error) {
    console.error('[PUT /api/match/:token]', error);
    res.status(500).json({ error: 'Impossible de mettre à jour le match.' });
  }
});

app.put(paths('/api/match/:token/holes/:hole'), (req, res) => {
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

    const state = db.setHole(match.id, holeNumber, result);
    res.json({ ...state, courseData: courses.getCourse(state.course) });
  } catch (error) {
    console.error('[PUT /api/match/:token/holes/:hole]', error);
    res.status(500).json({ error: 'Impossible de sauvegarder le trou.' });
  }
});

app.put(paths('/api/match/:token/strokes/:hole'), (req, res) => {
  try {
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    if (match.type !== 'strokeplay') return res.status(400).json({ error: 'Ce match n\'est pas en strokeplay.' });

    const holeNumber = Number(req.params.hole);
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
      return res.status(400).json({ error: 'Numéro de trou invalide.' });
    }

    const { score } = req.body || {};
    if (!Number.isInteger(score) || score < 1 || score > 20) {
      return res.status(400).json({ error: 'Score invalide (1–20).' });
    }

    const state = db.setStroke(match.id, holeNumber, score);
    res.json({ ...state, courseData: courses.getCourse(state.course) });
  } catch (error) {
    console.error('[PUT /api/match/:token/strokes/:hole]', error);
    res.status(500).json({ error: 'Impossible de sauvegarder le score.' });
  }
});

// ── Session match list (admin) ────────────────────────────────────────────────

app.get(paths('/api/session/matches'), (req, res) => {
  try {
    if (!checkSessionCode(req.query.code)) return res.status(401).json({ error: 'Code de session incorrect.' });
    const session = db.getActiveSession();
    res.json(db.getAllMatchesForSession(session.id));
  } catch (error) {
    console.error('[GET /api/session/matches]', error);
    res.status(500).json({ error: 'Impossible de charger les matchs.' });
  }
});

app.get(paths('/api/courses'), (_req, res) => {
  res.json(courses.getCourseOptions());
});

app.post(paths('/api/match/:token/hide'), (req, res) => {
  try {
    const { code } = req.body || {};
    if (!checkSessionCode(code)) return res.status(401).json({ error: 'Code de session incorrect.' });
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    db.setMatchHidden(match.id, true);
    res.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/match/:token/hide]', error);
    res.status(500).json({ error: 'Impossible de masquer le match.' });
  }
});

app.post(paths('/api/match/:token/unhide'), (req, res) => {
  try {
    const { code } = req.body || {};
    if (!checkSessionCode(code)) return res.status(401).json({ error: 'Code de session incorrect.' });
    const match = db.getMatchByToken(req.params.token);
    if (!match) return res.status(404).json({ error: 'Match introuvable.' });
    db.setMatchHidden(match.id, false);
    res.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/match/:token/unhide]', error);
    res.status(500).json({ error: 'Impossible de restaurer le match.' });
  }
});

// ── Live feed ─────────────────────────────────────────────────────────────────

app.get([...paths('/live'), ...paths('/live/:matchId')], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live.html'));
});

app.get(paths('/api/live'), (_req, res) => {
  try {
    const session = db.getActiveSession();
    const matches = db.readLiveState(session.id);
    for (const match of matches) {
      match.courseData = courses.getCourse(match.course);
    }
    res.json({ session: { id: session.id, name: session.name, date: session.date }, matches });
  } catch (error) {
    console.error('[GET /api/live]', error);
    res.status(500).json({ error: 'Impossible de charger le live.' });
  }
});

// ── Audit ─────────────────────────────────────────────────────────────────────

app.get(paths('/match/:token/audit'), (req, res) => {
  const match = db.getMatchByToken(req.params.token);
  if (!match) return res.status(404).send('<h1>Match introuvable</h1>');
  res.sendFile(path.join(__dirname, 'public', 'audit.html'));
});

app.get(paths('/api/match/:token/audit'), (req, res) => {
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

app.get(paths('/'), (_req, res) => res.sendFile(path.join(__dirname, 'public', 'live.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Golf matchplay live app running on http://localhost:${PORT}`);
  });
}

module.exports = app;
