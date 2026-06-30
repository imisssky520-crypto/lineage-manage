import { api, escapeHtml } from './api.js';

export function participantPickerHtml(label = '參與人員') {
  return `
    <label class="field-label participant-picker-field" style="grid-column:1/-1">
      ${label}
      <div class="participant-picker">
        <div class="participant-chips" data-chips></div>
        <div class="participant-search-wrap">
          <input type="text" class="participant-search" placeholder="搜尋帳號關鍵字…" autocomplete="off" />
          <ul class="participant-suggestions hidden" data-suggestions></ul>
        </div>
      </div>
    </label>`;
}

export function mountParticipantPicker(rootEl, { initial = [] } = {}) {
  if (!rootEl) return null;

  const chipsEl = rootEl.querySelector('[data-chips]');
  const searchInput = rootEl.querySelector('.participant-search');
  const suggestionsEl = rootEl.querySelector('[data-suggestions]');
  const selected = new Set();

  let searchTimer = null;
  let blurTimer = null;

  function renderChips() {
    chipsEl.innerHTML = [...selected]
      .map(
        (account) => `
        <span class="participant-chip" data-account="${escapeHtml(account)}">
          <span>${escapeHtml(account)}</span>
          <button type="button" class="participant-chip-remove" aria-label="移除">×</button>
        </span>`
      )
      .join('');
    chipsEl.classList.toggle('is-empty', selected.size === 0);
  }

  function hideSuggestions() {
    suggestionsEl.classList.add('hidden');
    suggestionsEl.innerHTML = '';
  }

  function addAccount(account) {
    const name = String(account || '').trim();
    if (!name || selected.has(name)) return false;
    selected.add(name);
    renderChips();
    return true;
  }

  function removeAccount(account) {
    selected.delete(account);
    renderChips();
  }

  function setSelected(accounts) {
    selected.clear();
    (accounts || []).forEach((a) => {
      const name = String(a || '').trim();
      if (name) selected.add(name);
    });
    renderChips();
  }

  function getSelected() {
    return [...selected];
  }

  async function showSuggestions() {
    const q = searchInput.value.trim();
    if (!q) {
      hideSuggestions();
      return;
    }
    try {
      const accounts = await api('/api/users/accounts?q=' + encodeURIComponent(q));
      const filtered = accounts.filter((a) => !selected.has(a));
      if (!filtered.length) {
        suggestionsEl.innerHTML = '<li class="participant-suggestion muted-item">無符合帳號</li>';
      } else {
        suggestionsEl.innerHTML = filtered
          .map(
            (a) =>
              `<li><button type="button" class="participant-suggestion" data-pick="${escapeHtml(a)}">${escapeHtml(a)}</button></li>`
          )
          .join('');
      }
      suggestionsEl.classList.remove('hidden');
    } catch {
      hideSuggestions();
    }
  }

  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.participant-chip-remove');
    if (!btn) return;
    const chip = btn.closest('.participant-chip');
    if (chip?.dataset.account) removeAccount(chip.dataset.account);
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(showSuggestions, 200);
  });

  searchInput.addEventListener('focus', () => {
    clearTimeout(blurTimer);
    if (searchInput.value.trim()) showSuggestions();
  });

  searchInput.addEventListener('blur', () => {
    blurTimer = setTimeout(hideSuggestions, 150);
  });

  suggestionsEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  suggestionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    addAccount(btn.dataset.pick);
    searchInput.value = '';
    hideSuggestions();
    searchInput.focus();
  });

  setSelected(initial);
  return { getSelected, setSelected, addAccount, removeAccount };
}
