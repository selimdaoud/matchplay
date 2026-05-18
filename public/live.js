const state = {
  matches: [],
  detailId: null,
};

const $ = (sel) => document.querySelector(sel);

function getMatchIdFromUrl() {
  const idx = window.location.pathname.indexOf('/live/');
  if (idx < 0) return null;
  return window.location.pathname.slice(idx + '/live/'.length).replace(/\/$/, '') || null;
}

async function fetchLive() {
  const res = await fetch(`${APP_BASE}/api/live`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Impossible de charger le live.');
  const data = await res.json();
  state.matches = data.matches || [];
}

function renderMatchplayHistory(match, holes) {
  if (!holes.length) return '<div class="empty">Aucun trou saisi.</div>';
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  return `
    <div class="history-wrap">
      <table>
        <tr><th>Trou</th><th>Résultat</th><th>${ref}</th></tr>
        ${holes.map((h) => `
          <tr>
            <td>${h.hole}${h.recordedAt ? `<br><span class="ts">${formatTime(h.recordedAt)}</span>` : ''}</td>
            <td class="result-cell">
              <span class="mark ${RESULT[h.result].className}">${RESULT[h.result].short}</span>
            </td>
            <td>${h.scoreText}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
}

function renderStrokeHistory(strokes) {
  if (!strokes.length) return '<div class="empty">Aucun trou saisi.</div>';
  const total = strokes.reduce((s, h) => s + h.score, 0);
  return `
    <div class="history-wrap">
      <table>
        <tr><th>Trou</th><th>Coups</th></tr>
        ${strokes.map((h) => `
          <tr>
            <td>${h.hole}${h.recordedAt ? `<br><span class="ts">${formatTime(h.recordedAt)}</span>` : ''}</td>
            <td>${h.score}</td>
          </tr>
        `).join('')}
        <tr>
          <td><strong>Total</strong></td>
          <td><strong>${total}</strong></td>
        </tr>
      </table>
    </div>
  `;
}

function renderMatchCard(match, clickable) {
  const attrs = clickable ? `data-action="open-match" data-id="${escapeHtml(match.id)}"` : '';
  const cls = `card${clickable ? ' match-list-card' : ''}`;

  if (match.type === 'strokeplay') {
    const status = strokeStatus(match);
    const strokes = [...(match.strokes || [])].sort((a, b) => a.hole - b.hole);
    const ref = escapeHtml(match.referencePlayer || 'Joueur');
    return `
      <article class="${cls}" ${attrs}>
        <div class="match-head">
          <div>
            <div class="match-title">${escapeHtml(match.title || 'Partie')}</div>
            <div class="players"><strong>${ref}</strong></div>
          </div>
          <div class="scorebox">
            <div class="current-score">${status.total}</div>
            <div class="status">${escapeHtml(status.detail)}</div>
          </div>
        </div>
        ${!clickable ? renderStrokeHistory(strokes) : ''}
      </article>
    `;
  }

  const holes = enrichHoles(match);
  const status = matchStatus(match);
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  const opp = escapeHtml(match.opponent || 'Adversaire');
  return `
    <article class="${cls}" ${attrs}>
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
      ${!clickable ? renderMatchplayHistory(match, holes) : ''}
    </article>
  `;
}

function liveTitle(matches) {
  const types = new Set(matches.map((m) => m.type || 'matchplay'));
  if (types.size > 1) return 'Golf Live';
  return types.has('strokeplay') ? 'Strokeplay Live' : 'Matchplay Live';
}

function renderList() {
  $('h1').textContent = liveTitle(state.matches);
  $('#subtitle').textContent = `${state.matches.length} match${state.matches.length > 1 ? 's' : ''} en cours`;
  if (!state.matches.length) {
    $('#content').innerHTML = '<div class="card"><p style="color:var(--muted)">Aucun match en cours.</p></div>';
    return;
  }
  $('#content').innerHTML = `<div class="matches">${state.matches.map((m) => renderMatchCard(m, true)).join('')}</div>`;
}

function renderDetail() {
  const match = state.matches.find((m) => m.id === state.detailId);
  if (!match) { showList(); return; }

  $('h1').textContent = match.type === 'strokeplay' ? 'Strokeplay Live' : 'Matchplay Live';
  $('#subtitle').textContent = match.type === 'strokeplay'
    ? (match.referencePlayer || '…')
    : `${match.referencePlayer || '…'} vs ${match.opponent || '…'}`;
  $('#content').innerHTML = `
    <button class="back-btn" data-action="back">← Tous les matchs</button>
    ${renderMatchCard(match, false)}
  `;
}

function showList() {
  state.detailId = null;
  history.pushState({}, '', `${APP_BASE}/live`);
  renderList();
}

function showDetail(matchId) {
  state.detailId = matchId;
  history.pushState({}, '', `${APP_BASE}/live/${matchId}`);
  renderDetail();
}

function render() {
  if (state.detailId) renderDetail();
  else renderList();
}

$('#content').addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'open-match') showDetail(target.dataset.id);
  if (target.dataset.action === 'back') showList();
});

window.addEventListener('popstate', () => {
  state.detailId = getMatchIdFromUrl();
  render();
});

async function init() {
  state.detailId = getMatchIdFromUrl();
  try {
    await fetchLive();
    render();
    setInterval(async () => {
      try { await fetchLive(); render(); } catch (_) {}
    }, 5000);
  } catch (error) {
    $('#content').innerHTML = `<div class="card"><strong>Erreur</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
