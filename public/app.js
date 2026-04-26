const BASE_URL = window.location.pathname.replace(/\/live\/?$/, '').replace(/\/$/, '');

const state = {
  data: { matches: [] },
  readonly: window.location.pathname.endsWith('/live') || new URLSearchParams(window.location.search).get('readonly') === '1',
  editing: null,
  saving: false,
  expanded: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const matchesEl = $('#matches');
const modePill = $('#modePill');
const subtitle = $('#subtitle');
const toolbar = $('#toolbar');

const RESULT = {
  win: { label: 'Gagné', short: 'G', className: 'win', delta: 1 },
  halve: { label: 'Partagé', short: '½', className: 'halve', delta: 0 },
  loss: { label: 'Perdu', short: 'P', className: 'loss', delta: -1 },
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

function matchStatus(match) {
  const holes = enrichHoles(match);
  if (!holes.length) return { score: 'AS', detail: 'Départ', finished: false, nextHole: 1 };

  const last = holes[holes.length - 1];
  const holesPlayed = last.hole;

  if (holesPlayed >= 18) {
    const label = holesPlayed > 18 ? `Play-off · trou ${holesPlayed}` : `Trou ${holesPlayed}`;
    return {
      score: last.scoreText,
      detail: `${label} · prochain trou ${holesPlayed + 1}`,
      finished: false,
      nextHole: holesPlayed + 1,
    };
  }

  return { score: last.scoreText, detail: `Prochain trou ${holesPlayed + 1}`, finished: false, nextHole: holesPlayed + 1 };
}

async function fetchData() {
  const res = await fetch(`${BASE_URL}/api`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Impossible de charger les scores.');
  state.data = await res.json();
}

let saveInFlight = false;
let savePending = false;

async function saveData() {
  if (saveInFlight) {
    savePending = true;
    return;
  }
  saveInFlight = true;
  state.saving = true;
  render();
  try {
    const res = await fetch(`${BASE_URL}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Impossible de sauvegarder.');
    }
    state.data = await res.json();
  } finally {
    saveInFlight = false;
    state.saving = false;
    render();
    if (savePending) {
      savePending = false;
      saveData();
    }
  }
}

function setHole(matchId, holeNumber, result) {
  const match = state.data.matches.find((m) => m.id === matchId);
  if (!match) return;

  const index = match.holes.findIndex((h) => h.hole === holeNumber);
  if (index >= 0) match.holes[index].result = result;
  else match.holes.push({ hole: holeNumber, result });
  match.holes.sort((a, b) => a.hole - b.hole);
  saveData().catch((e) => alert(e.message));
}

function deleteHole(matchId, holeNumber) {
  const match = state.data.matches.find((m) => m.id === matchId);
  if (!match) return;
  match.holes = match.holes.filter((h) => h.hole !== holeNumber);
  saveData().catch((e) => alert(e.message));
}

function updateNames(matchId, field, value) {
  const match = state.data.matches.find((m) => m.id === matchId);
  if (!match) return;
  match[field] = value;
  saveData().catch((e) => alert(e.message));
}

function renderChoiceButtons(match, holeNumber) {
  if (state.readonly) return '';
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  return `
    <div class="entry">
      <div class="entry-top">
        <div class="hole-label">Trou ${holeNumber}</div>
        <div class="hint">Saisir le résultat du trou</div>
      </div>
      <div class="choice-grid">
        <button class="choice win" data-action="set-hole" data-match="${match.id}" data-hole="${holeNumber}" data-result="win">
          ${ref} gagne<small>+1 trou</small>
        </button>
        <button class="choice halve" data-action="set-hole" data-match="${match.id}" data-hole="${holeNumber}" data-result="halve">
          Partagé<small>score inchangé</small>
        </button>
        <button class="choice loss" data-action="set-hole" data-match="${match.id}" data-hole="${holeNumber}" data-result="loss">
          ${ref} perd<small>-1 trou</small>
        </button>
      </div>
    </div>
  `;
}

function renderHistory(match, holes) {
  if (!holes.length) return '<div class="empty">Aucun trou saisi.</div>';
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  const editable = state.readonly ? '' : 'editable';

  return `
    <div class="history-wrap">
      <table>
        <tr>
          <th>Trou</th>
          <th>Résultat</th>
          <th>${ref}</th>
        </tr>
        ${holes.map((h) => `
          <tr>
            <td>${h.hole}</td>
            <td class="result-cell ${editable}" data-action="edit-hole" data-match="${match.id}" data-hole="${h.hole}">
              <span class="mark ${RESULT[h.result].className}">${RESULT[h.result].short}</span>
            </td>
            <td>${h.scoreText}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
}

function renderMatch(match) {
  const holes = enrichHoles(match);
  const status = matchStatus(match);
  const nextHole = status.nextHole;
  const ref = escapeHtml(match.referencePlayer || 'Référence');
  const opp = escapeHtml(match.opponent || 'Adversaire');
  const isExpanded = state.expanded.has(match.id);

  const bigButtons = state.readonly ? '' : `
    <div class="big-choice-grid">
      <button class="big-choice win" data-action="set-hole" data-match="${match.id}" data-hole="${nextHole}" data-result="win">
        Gagné<small>trou ${nextHole}</small>
      </button>
      <button class="big-choice halve" data-action="set-hole" data-match="${match.id}" data-hole="${nextHole}" data-result="halve">
        ½<small>partagé</small>
      </button>
      <button class="big-choice loss" data-action="set-hole" data-match="${match.id}" data-hole="${nextHole}" data-result="loss">
        Perdu<small>trou ${nextHole}</small>
      </button>
    </div>
  `;

  const expandedSection = `
    <div class="expanded-section"${isExpanded || state.readonly ? '' : ' style="display:none"'}>
      ${state.readonly ? '' : `
        <div class="edit-names">
          <input value="${ref}" placeholder="Joueur de référence" data-action="name" data-match="${match.id}" data-field="referencePlayer">
          <input value="${opp}" placeholder="Adversaire" data-action="name" data-match="${match.id}" data-field="opponent">
        </div>
      `}
      <div class="section-title">
        <span>Historique</span>
        <span>${holes.length ? `${holes.length} trou${holes.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      ${renderHistory(match, holes)}
      ${state.readonly ? '' : `
        <div class="footer-actions">
          <button class="btn subtle" data-action="reset-match" data-match="${match.id}">Reset match</button>
        </div>
      `}
    </div>
  `;

  return `
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
      ${state.readonly ? '' : `
        <button class="toggle-expand" data-action="toggle-expand" data-match="${match.id}">
          ${isExpanded ? '▲ Masquer' : '▼ Historique & réglages'}
        </button>
      `}
      ${expandedSection}
    </article>
  `;
}

function render() {
  modePill.textContent = state.readonly ? 'Live read-only' : (state.saving ? 'Sauvegarde…' : 'Mode saisie');
  subtitle.textContent = state.readonly
    ? 'Même affichage que la saisie, sans modification possible.'
    : 'Saisie par trou gagné, partagé ou perdu. Le score cumulé est calculé automatiquement.';
  toolbar.style.display = state.readonly ? 'none' : 'flex';
  matchesEl.innerHTML = state.data.matches.map(renderMatch).join('');
}

function openEditModal(matchId, holeNumber) {
  if (state.readonly) return;
  const match = state.data.matches.find((m) => m.id === matchId);
  if (!match) return;
  state.editing = { matchId, holeNumber };

  $('#modalText').textContent = `Trou ${holeNumber} · ${match.referencePlayer}`;
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
  state.editing = null;
}

matchesEl.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const matchId = target.dataset.match;
  const hole = Number(target.dataset.hole);

  if (action === 'set-hole') setHole(matchId, hole, target.dataset.result);
  if (action === 'edit-hole') openEditModal(matchId, hole);
  if (action === 'toggle-expand') {
    if (state.expanded.has(matchId)) state.expanded.delete(matchId);
    else state.expanded.add(matchId);
    render();
  }
  if (action === 'reset-match' && confirm('Réinitialiser ce match ?')) {
    const match = state.data.matches.find((m) => m.id === matchId);
    if (match) {
      match.holes = [];
      saveData().catch((e) => alert(e.message));
    }
  }
});

matchesEl.addEventListener('change', (event) => {
  const target = event.target.closest('[data-action="name"]');
  if (!target) return;
  updateNames(target.dataset.match, target.dataset.field, target.value.trim());
});

$('#modalChoices').addEventListener('click', (event) => {
  const target = event.target.closest('[data-action="modal-set"]');
  if (!target || !state.editing) return;
  setHole(state.editing.matchId, state.editing.holeNumber, target.dataset.result);
  closeModal();
});

$('#deleteHole').addEventListener('click', () => {
  if (!state.editing) return;
  if (confirm('Supprimer ce trou ? Les scores suivants seront recalculés.')) {
    deleteHole(state.editing.matchId, state.editing.holeNumber);
    closeModal();
  }
});

$('#closeModal').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', (event) => {
  if (event.target.id === 'modalBackdrop') closeModal();
});

$('#copyLiveLink')?.addEventListener('click', async () => {
  const url = `${window.location.origin}${BASE_URL}/live`;
  await navigator.clipboard.writeText(url);
  alert('Lien live copié.');
});

$('#resetAll')?.addEventListener('click', () => {
  if (!confirm('Réinitialiser les deux matchs ?')) return;
  state.data.matches.forEach((match) => { match.holes = []; });
  saveData().catch((e) => alert(e.message));
});

async function init() {
  try {
    await fetchData();
    render();
    setInterval(async () => {
      try {
        await fetchData();
        render();
      } catch (_) {}
    }, state.readonly ? 2000 : 8000);
  } catch (error) {
    matchesEl.innerHTML = `<div class="card"><strong>Erreur</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
