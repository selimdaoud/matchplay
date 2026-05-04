const token = window.location.pathname.split('/')[2];
const BASE = `/api/match/${token}`;

const state = {
  match: null,
  editing: null,
};

const $ = (sel) => document.querySelector(sel);

async function fetchMatch() {
  const res = await fetch(BASE, { cache: 'no-store' });
  if (!res.ok) throw new Error('Match introuvable.');
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
  state.editing = null;
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
  const target = event.target.closest('[data-action="modal-set"]');
  if (!target || !state.editing) return;
  try {
    await putHole(state.editing.holeNumber, target.dataset.result);
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
  const url = `${window.location.origin}/live`;
  await navigator.clipboard.writeText(url);
  const btn = $('#copyLiveLink');
  btn.textContent = 'Copié !';
  setTimeout(() => { btn.textContent = 'Copier le lien live'; }, 2000);
});

$('#openAudit').addEventListener('click', () => {
  window.open(`/match/${token}/audit`, '_blank');
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
