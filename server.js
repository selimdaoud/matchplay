const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function validateData(payload) {
  if (!payload || !Array.isArray(payload.matches)) {
    throw new Error('Invalid payload: matches array is required.');
  }

  payload.matches.forEach((match, index) => {
    if (!match.id) match.id = `match-${index + 1}`;
    if (!match.title) match.title = `Match ${index + 1}`;
    if (typeof match.referencePlayer !== 'string') match.referencePlayer = '';
    if (typeof match.opponent !== 'string') match.opponent = '';
    if (!Array.isArray(match.holes)) match.holes = [];

    match.holes = match.holes
      .filter((hole) => hole && Number.isInteger(hole.hole) && ['win', 'halve', 'loss'].includes(hole.result))
      .sort((a, b) => a.hole - b.hole);
  });

  return payload;
}

app.get('/api', (_req, res) => {
  try {
    res.json(db.readState());
  } catch (error) {
    console.error('[GET /api]', error);
    res.status(500).json({ error: 'Unable to read scores.' });
  }
});

app.post('/api', (req, res) => {
  try {
    const data = validateData(req.body);
    res.json(db.writeState(data.matches));
  } catch (error) {
    console.error('[POST /api]', error);
    res.status(400).json({ error: error.message || 'Unable to save scores.' });
  }
});

app.get(['/live', '/'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Golf matchplay live app running on http://localhost:${PORT}`);
});
