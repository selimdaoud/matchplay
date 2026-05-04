const state = {
  matches: [],
  detailId: null,
};

const $ = (sel) => document.querySelector(sel);

function getMatchIdFromUrl() {
  const parts = window.location.pathname.split('/');
  // /live/:matchId → parts[2]
  return parts[2] || null;
}

async function fetchLive() {
  const res = await fetch('/api/live', { cache: 'no-store' });
  if (!res.ok) throw new Error('Impossible de charger le live.');
  const data = await res.json();
  state.matches = data.matches || [];
}

function renderMatchCard(match, clickable) {
  const holes = enrichHoles(match);
  const status = matchStatus(match);
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  const opp = escapeHtml(match.opponent || 'Adversaire');

  return `
    <article class="card${clickable ? ' match-list-card' : ''}" ${clickable ? `data-action="open-match" data-id="${escapeHtml(match.id)}"` : ''}>
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
      ${!clickable ? renderHistory(match, holes) : ''}
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

function renderList() {
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

  $('#subtitle').textContent = `${match.referencePlayer || '…'} vs ${match.opponent || '…'}`;
  $('#content').innerHTML = `
    <button class="back-btn" data-action="back">← Tous les matchs</button>
    ${renderMatchCard(match, false)}
  `;
}

function showList() {
  state.detailId = null;
  history.pushState({}, '', '/live');
  renderList();
}

function showDetail(matchId) {
  state.detailId = matchId;
  history.pushState({}, '', `/live/${matchId}`);
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
