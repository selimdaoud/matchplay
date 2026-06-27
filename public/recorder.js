const token = window.location.pathname.slice(
  window.location.pathname.indexOf('/match/') + '/match/'.length
).replace(/\/$/, '');
const BASE = `${APP_BASE}/api/match/${token}`;

const state = {
  match: null,
  editing: null,
  pendingHole: null,
  pendingScore: 4,
};

const $ = (sel) => document.querySelector(sel);

async function fetchMatch() {
  const res = await fetch(BASE, { cache: 'no-store' });
  if (!res.ok) throw new Error('Match introuvable.');
  state.match = await res.json();
}

async function putStroke(holeNumber, score) {
  const res = await fetch(`${BASE}/strokes/${holeNumber}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Erreur de sauvegarde.');
  }
  state.match = await res.json();
}

async function putHole(holeNumber, result) {
  const res = await fetch(`${BASE}/holes/${holeNumber}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Erreur de sauvegarde.');
  }
  state.match = await res.json();
}

async function putMatch(fields) {
  const res = await fetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Erreur de mise à jour.');
  }
  state.match = await res.json();
}

function defaultStrokeScore(match, holeNumber) {
  const hole = courseHole(match, holeNumber);
  if (hole && Number.isFinite(hole.par)) return Math.max(1, Math.min(20, hole.par));
  return 4;
}

function syncPendingStrokeScore(match, holeNumber) {
  if (state.pendingHole === holeNumber) return;
  state.pendingHole = holeNumber;
  state.pendingScore = defaultStrokeScore(match, holeNumber);
}

function renderCoursePanel(match, holeNumber, score = null) {
  if (!match.course || match.course === 'none') return '';
  const hole = courseHole(match, holeNumber);
  const title = `${escapeHtml(courseName(match))} · Trou ${holeNumber}`;
  if (!hole) {
    return `
      <div class="course-panel">
        <div class="course-panel-title">${title}</div>
        <div class="course-empty">Données du trou non renseignées.</div>
      </div>
    `;
  }

  const scored = Number.isFinite(score);
  return `
    <div class="course-panel">
      <div class="course-panel-title">${title}</div>
      <div class="course-metrics">
        <div><span>Par</span><strong>${hole.par}</strong></div>
        <div><span>Moyenne</span><strong>${hole.averageScore.toFixed(2)}</strong></div>
        ${scored ? `<div><span>Vs par</span><strong>${formatSigned(score - hole.par)}</strong></div>` : ''}
        ${scored ? `<div><span>Vs moy.</span><strong>${formatSigned(score - hole.averageScore)}</strong></div>` : ''}
      </div>
    </div>
  `;
}

function renderStrokeSummary(match) {
  if (!hasCourseData(match)) return '';
  const totals = strokeCourseTotals(match);
  if (!totals.par) return '';
  return `
    <div class="status">
      Par ${formatSigned(totals.vsPar)} · Moy. ${formatSigned(totals.vsAverage)}
    </div>
  `;
}

function renderStrokeCourseCells(match, stroke) {
  const hole = courseHole(match, stroke.hole);
  if (!hole) return '<td>—</td>';
  return `
    <td>${formatSigned(stroke.score - hole.averageScore)}</td>
  `;
}

function renderStrokeHistory(match, strokes) {
  if (!strokes.length) return '<div class="empty">Aucun trou saisi.</div>';
  const total = strokes.reduce((s, h) => s + h.score, 0);
  const showCourse = hasCourseData(match);
  const totals = strokeCourseTotals(match);
  return `
    <div class="history-wrap">
      <table>
        <tr>
          <th>Trou</th><th>Coups</th>
          ${showCourse ? '<th>Vs moy.</th>' : ''}
        </tr>
        ${strokes.map((h) => `
          <tr>
            <td>${renderStrokeHoleLabel(match, h)}${h.recordedAt ? `<br><span class="ts">${formatTime(h.recordedAt)}</span>` : ''}</td>
            <td class="result-cell editable" data-action="edit-stroke" data-hole="${h.hole}" data-score="${h.score}">
              ${h.score}
            </td>
            ${showCourse ? renderStrokeCourseCells(match, h) : ''}
          </tr>
        `).join('')}
        <tr>
          <td><strong>Total</strong></td>
          <td><strong>${total}</strong></td>
          ${showCourse ? `
            <td><strong>${totals.average ? formatSigned(totals.vsAverage) : '—'}</strong></td>
          ` : ''}
        </tr>
      </table>
    </div>
  `;
}

function renderStrokeHoleLabel(match, stroke) {
  const hole = courseHole(match, stroke.hole);
  if (!hole) return stroke.hole;
  return `${stroke.hole} <span class="hole-par">(par ${hole.par})</span>`;
}

function renderStrokeplay() {
  const match = state.match;
  const strokes = [...(match.strokes || [])].sort((a, b) => a.hole - b.hole);
  const status = strokeStatus(match);
  const ref = escapeHtml(match.referencePlayer || 'Joueur');
  if (!status.finished) syncPendingStrokeScore(match, status.nextHole);

  $('title').textContent = `${match.title || 'Partie'} — Matchplay Live`;
  $('#subtitle').textContent = match.referencePlayer || '…';

  const inputSection = status.finished ? `
    <div class="finished-banner">
      Partie terminée · ${status.total} coups
      <div style="font-size:13px;font-weight:600;margin-top:4px;color:var(--accent)">
        Corrigez un trou dans l'historique si nécessaire.
      </div>
    </div>
  ` : `
    <div class="stroke-input">
      <div class="stroke-hole-label">Trou ${status.nextHole}</div>
      ${renderCoursePanel(match, status.nextHole, state.pendingScore)}
      <div class="stroke-counter">
        <button class="stroke-adj" data-action="stroke-dec">−</button>
        <span class="stroke-value" id="strokeValueDisplay">${state.pendingScore}</span>
        <button class="stroke-adj" data-action="stroke-inc">+</button>
      </div>
      <button class="btn primary full-width-btn" data-action="confirm-stroke" data-hole="${status.nextHole}">
        Enregistrer trou ${status.nextHole}
      </button>
    </div>
  `;

  $('#matchSection').innerHTML = `
    <article class="card">
      <div class="match-head">
        <div>
          <div class="match-title">${escapeHtml(match.title || 'Partie')}</div>
          <div class="players"><strong>${ref}</strong></div>
        </div>
        <div class="scorebox">
          <div class="current-score">${status.total}</div>
          <div class="status">${escapeHtml(status.detail)}</div>
          ${renderStrokeSummary(match)}
        </div>
      </div>
      ${inputSection}
      <div class="expanded-section">
        <div class="edit-names" style="grid-template-columns:1fr">
          <input value="${ref}" placeholder="Nom du joueur" data-field="referencePlayer">
        </div>
        <div class="section-title">
          <span>Historique</span>
          <span>${strokes.length ? `${strokes.length} trou${strokes.length > 1 ? 's' : ''}` : ''}</span>
        </div>
        ${renderStrokeHistory(match, strokes)}
      </div>
    </article>
  `;
}

function renderHistory(match, holes) {
  if (!holes.length) return '<div class="empty">Aucun trou saisi.</div>';
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  return `
    <div class="history-wrap">
      <table>
        <tr><th>Trou</th><th>Résultat</th><th>${ref}</th></tr>
        ${holes.map((h) => `
          <tr>
            <td>${h.hole}${h.recordedAt ? `<br><span class="ts">${formatTime(h.recordedAt)}</span>` : ''}</td>
            <td class="result-cell editable" data-action="edit-hole" data-hole="${h.hole}">
              <span class="mark ${RESULT[h.result].className}">${RESULT[h.result].short}</span>
            </td>
            <td>${h.scoreText}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
}

function render() {
  const match = state.match;
  if (!match) return;
  if (match.type === 'strokeplay') { renderStrokeplay(); return; }

  const holes = enrichHoles(match);
  const status = matchStatus(match);
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  const opp = escapeHtml(match.opponent || 'Adversaire');

  $('title').textContent = `${match.title || 'Match'} — Matchplay Live`;
  $('#subtitle').textContent = `${match.referencePlayer || '…'} vs ${match.opponent || '…'}`;

  const bigButtons = status.finished ? `
    <div class="finished-banner">
      Match terminé · ${escapeHtml(status.detail)}
      <div style="font-size:13px;font-weight:600;margin-top:4px;color:var(--accent)">
        Corrigez un trou dans l'historique si nécessaire.
      </div>
    </div>
  ` : `
    ${renderCoursePanel(match, status.nextHole)}
    <div class="big-choice-grid">
      <button class="big-choice win" data-action="set-hole" data-hole="${status.nextHole}" data-result="win">
        Gagné<small>trou ${status.nextHole}</small>
      </button>
      <button class="big-choice halve" data-action="set-hole" data-hole="${status.nextHole}" data-result="halve">
        ½<small>partagé</small>
      </button>
      <button class="big-choice loss" data-action="set-hole" data-hole="${status.nextHole}" data-result="loss">
        Perdu<small>trou ${status.nextHole}</small>
      </button>
    </div>
  `;

  $('#matchSection').innerHTML = `
    <article class="card">
      <div class="match-head">
        <div>
          <div class="match-title">${escapeHtml(match.title || 'Match')}</div>
          <div class="players"><strong>${ref}</strong><span>vs</span><strong>${opp}</strong></div>
        </div>
        <div class="scorebox">
          <div class="current-score">${status.score}</div>
          <div class="status">${escapeHtml(status.detail)}</div>
        </div>
      </div>
      ${bigButtons}
      <div class="expanded-section">
        <div class="edit-names">
          <input value="${ref}" placeholder="Joueur de référence" data-field="referencePlayer">
          <input value="${opp}" placeholder="Adversaire" data-field="opponent">
        </div>
        <div class="section-title">
          <span>Historique</span>
          <span>${holes.length ? `${holes.length} trou${holes.length > 1 ? 's' : ''}` : ''}</span>
        </div>
        ${renderHistory(match, holes)}
      </div>
    </article>
  `;
}

function openEditModal(holeNumber) {
  const match = state.match;
  if (!match) return;
  state.editing = { holeNumber };

  $('#modalText').textContent = `Trou ${holeNumber} · ${match.referencePlayer || 'Référence'}`;
  $('#modalChoices').innerHTML = ['win', 'halve', 'loss'].map((result) => `
    <button class="choice ${RESULT[result].className}" data-action="modal-set" data-result="${result}">
      ${escapeHtml(resultLabel(result, match.referencePlayer || 'Référence'))}
      <small>${result === 'win' ? '+1 trou' : result === 'loss' ? '-1 trou' : 'score inchangé'}</small>
    </button>
  `).join('');

  $('#modalBackdrop').classList.add('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'false');
}

function closeModal() {
  $('#modalBackdrop').classList.remove('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'true');
  $('#modalConfirm').style.display = 'none';
  state.editing = null;
}

function openStrokeEditModal(holeNumber, currentScore) {
  state.editing = { holeNumber, type: 'stroke', score: currentScore };
  $('#modalTitle').textContent = `Corriger trou ${holeNumber}`;
  $('#modalText').textContent = `Score actuel : ${currentScore} coup${currentScore > 1 ? 's' : ''}`;
  $('#modalChoices').innerHTML = `
    <div class="stroke-edit-counter">
      <button class="stroke-adj" data-action="modal-stroke-dec">−</button>
      <span class="stroke-value" id="modalStrokeValue">${currentScore}</span>
      <button class="stroke-adj" data-action="modal-stroke-inc">+</button>
    </div>
  `;
  $('#modalConfirm').style.display = '';
  $('#modalBackdrop').classList.add('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'false');
}

$('#matchSection').addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;

  if (action === 'set-hole') {
    try {
      await putHole(Number(target.dataset.hole), target.dataset.result);
      render();
    } catch (e) {
      alert(e.message);
    }
  }

  if (action === 'edit-hole') {
    openEditModal(Number(target.dataset.hole));
  }

  if (action === 'stroke-dec') {
    state.pendingScore = Math.max(1, state.pendingScore - 1);
    render();
  }

  if (action === 'stroke-inc') {
    state.pendingScore = Math.min(20, state.pendingScore + 1);
    render();
  }

  if (action === 'confirm-stroke') {
    try {
      await putStroke(Number(target.dataset.hole), state.pendingScore);
      state.pendingHole = null;
      render();
    } catch (e) {
      alert(e.message);
    }
  }

  if (action === 'edit-stroke') {
    openStrokeEditModal(Number(target.dataset.hole), Number(target.dataset.score));
  }
});

$('#matchSection').addEventListener('change', async (event) => {
  const target = event.target.closest('[data-field]');
  if (!target) return;
  try {
    await putMatch({ [target.dataset.field]: target.value.trim() });
    render();
  } catch (e) {
    alert(e.message);
  }
});

$('#modalChoices').addEventListener('click', async (event) => {
  if (!state.editing) return;

  if (state.editing.type === 'stroke') {
    const adj = event.target.closest('[data-action]');
    if (!adj) return;
    if (adj.dataset.action === 'modal-stroke-dec') {
      state.editing.score = Math.max(1, state.editing.score - 1);
      document.getElementById('modalStrokeValue').textContent = state.editing.score;
    }
    if (adj.dataset.action === 'modal-stroke-inc') {
      state.editing.score = Math.min(20, state.editing.score + 1);
      document.getElementById('modalStrokeValue').textContent = state.editing.score;
    }
    return;
  }

  const target = event.target.closest('[data-action="modal-set"]');
  if (!target) return;
  try {
    await putHole(state.editing.holeNumber, target.dataset.result);
    closeModal();
    render();
  } catch (e) {
    alert(e.message);
  }
});

$('#modalConfirm').addEventListener('click', async () => {
  if (!state.editing || state.editing.type !== 'stroke') return;
  try {
    await putStroke(state.editing.holeNumber, state.editing.score);
    closeModal();
    render();
  } catch (e) {
    alert(e.message);
  }
});

$('#closeModal').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', (event) => {
  if (event.target.id === 'modalBackdrop') closeModal();
});

$('#copyLiveLink').addEventListener('click', async () => {
  const url = `${window.location.origin}${APP_BASE}/live`;
  await navigator.clipboard.writeText(url);
  const btn = $('#copyLiveLink');
  btn.textContent = 'Copié !';
  setTimeout(() => { btn.textContent = 'Copier le lien live'; }, 2000);
});

$('#openAudit').addEventListener('click', () => {
  window.open(`${APP_BASE}/match/${token}/audit`, '_blank');
});

async function init() {
  try {
    await fetchMatch();
    render();
    setInterval(async () => {
      try { await fetchMatch(); render(); } catch (_) {}
    }, 10000);
  } catch (error) {
    $('#matchSection').innerHTML = `<div class="card"><strong>Erreur</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
