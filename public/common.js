const RESULT = {
  win:   { label: 'Gagné',   short: 'G', className: 'win',   delta:  1 },
  halve: { label: 'Partagé', short: '½', className: 'halve', delta:  0 },
  loss:  { label: 'Perdu',   short: 'P', className: 'loss',  delta: -1 },
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return 'E';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function scoreText(value) {
  if (value === 0) return 'AS';
  return value > 0 ? `${value} UP` : `${Math.abs(value)} DOWN`;
}

function resultLabel(result, refName) {
  if (result === 'win') return `${refName} gagne`;
  if (result === 'loss') return `${refName} perd`;
  return 'Partagé';
}

function orderedHoles(match) {
  return [...(match.holes || [])].sort((a, b) => a.hole - b.hole);
}

function enrichHoles(match) {
  let score = 0;
  return orderedHoles(match).map((hole) => {
    score += RESULT[hole.result]?.delta || 0;
    return { ...hole, cumulative: score, scoreText: scoreText(score) };
  });
}

function strokeHoleOrder(match) {
  const startHole = Number.isInteger(match.startHole) && match.startHole >= 1 && match.startHole <= 18
    ? match.startHole
    : 1;
  return Array.from({ length: 18 }, (_value, index) => ((startHole - 1 + index) % 18) + 1);
}

function orderedStrokes(match) {
  const order = strokeHoleOrder(match);
  const positions = new Map(order.map((hole, index) => [hole, index]));
  return [...(match.strokes || [])].sort((a, b) => (
    (positions.get(a.hole) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.hole) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function strokeStatus(match) {
  const strokes = orderedStrokes(match);
  const order = strokeHoleOrder(match);
  const playedHoles = new Set(strokes.map((stroke) => stroke.hole));
  const nextHole = order.find((hole) => !playedHoles.has(hole));
  if (!strokes.length) return { total: '—', detail: 'Départ', finished: false, nextHole: order[0] };
  const total = strokes.reduce((s, h) => s + h.score, 0);
  const finished = nextHole === undefined;
  return {
    total: String(total),
    detail: finished
      ? `Terminé · ${total} coup${total > 1 ? 's' : ''}`
      : `${strokes.length} trou${strokes.length > 1 ? 's' : ''} joué${strokes.length > 1 ? 's' : ''}`,
    finished,
    nextHole,
  };
}

function courseHole(match, holeNumber) {
  const holes = match.courseData?.holes || [];
  return holes.find((hole) => hole.hole === holeNumber) || null;
}

function courseName(match) {
  return match.courseData?.name || 'None';
}

function hasCourseData(match) {
  return Boolean(match.course && match.course !== 'none' && (match.courseData?.holes || []).length);
}

function strokeCourseTotals(match) {
  const strokes = orderedStrokes(match);
  let score = 0;
  let par = 0;
  let average = 0;
  for (const stroke of strokes) {
    const hole = courseHole(match, stroke.hole);
    if (!hole) continue;
    score += stroke.score;
    par += hole.par;
    average += hole.averageScore;
  }
  return { score, par, average, vsPar: score - par, strokesGained: average - score };
}

function matchStatus(match) {
  const holes = enrichHoles(match);
  if (!holes.length) return { score: 'AS', detail: 'Départ', finished: false, nextHole: 1 };

  const last = holes[holes.length - 1];
  const holesPlayed = last.hole;
  const holesRemaining = 18 - holesPlayed;
  const lead = Math.abs(last.cumulative);

  // Match won before hole 18: lead exceeds remaining holes
  if (holesPlayed < 18 && lead > holesRemaining) {
    const winner = last.cumulative > 0 ? match.referencePlayer : match.opponent;
    return {
      score: last.scoreText,
      detail: `${escapeHtml(winner || 'Joueur')} gagne ${lead}&${holesRemaining}`,
      finished: true,
      nextHole: holesPlayed + 1,
    };
  }

  // After hole 18
  if (holesPlayed >= 18) {
    if (last.cumulative !== 0) {
      const winner = last.cumulative > 0 ? match.referencePlayer : match.opponent;
      return {
        score: last.scoreText,
        detail: `${escapeHtml(winner || 'Joueur')} gagne ${lead} UP`,
        finished: true,
        nextHole: holesPlayed + 1,
      };
    }
    if (holesPlayed === 18) {
      return { score: 'AS', detail: 'AS après 18 — play-off', finished: false, nextHole: 19 };
    }
    // Play-off holes
    return { score: 'AS', detail: `Play-off · trou ${holesPlayed} — AS`, finished: false, nextHole: holesPlayed + 1 };
  }

  return { score: last.scoreText, detail: `Prochain trou ${holesPlayed + 1}`, finished: false, nextHole: holesPlayed + 1 };
}
