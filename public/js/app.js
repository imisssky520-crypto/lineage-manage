import { api, fmtDate, fmtNum, escapeHtml, exportCsv } from './api.js';
import { participantPickerHtml, mountParticipantPicker } from './participant-picker.js';

let currentUser = null;
let currentGroup = null;
let balanceChart = null;

const NAV = [
  { id: 'home', label: '🏠 首頁', icon: 'home' },
  { id: 'treasures', label: '🎁 寶物申報', icon: 'treasures' },
  { id: 'settings', label: '⚙️ 個人設定', icon: 'settings' },
  { id: 'todos', label: '📋 待辦清單', icon: 'todos' },
  { id: 'bank', label: '🏦 個人銀行', icon: 'bank' },
  { id: 'bank-overview', label: '💰 餘額總覽', icon: 'bank-overview' }
];

const ADMIN_NAV = [
  { id: 'withdraw-review', label: '📝 提領審核', admin: true },
  { id: 'deposits', label: '💎 儲值', admin: true },
  { id: 'deposit-perms', label: '🔑 儲值權限', admin: true },
  { id: 'guild-settings', label: '🏛️ 抽成設定', admin: true },
  { id: 'users', label: '👥 成員管理', admin: true },
  { id: 'announce', label: '📢 公告管理', admin: true }
];

function isAdmin() {
  return currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
}

function isSuperAdmin() {
  return currentUser?.role === 'super_admin';
}

const ROLE_LABELS = {
  super_admin: '最高管理員',
  admin: '管理員',
  deposit_admin: '儲值管理',
  member: '一般會員'
};

function roleOptions(selected = 'member') {
  const roles = currentUser?.role === 'super_admin'
    ? ['member', 'deposit_admin', 'admin', 'super_admin']
    : ['member', 'deposit_admin', 'admin'];
  return roles
    .map((r) => `<option value="${r}" ${r === selected ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`)
    .join('');
}

let pendingWithdrawCount = 0;

function renderNav() {
  const nav = document.getElementById('nav');
  const items = [...NAV];
  if (isAdmin()) items.push(...ADMIN_NAV.map((n) => ({
    ...n,
    label: n.id === 'withdraw-review' && pendingWithdrawCount > 0
      ? `${n.label} ${pendingWithdrawCount}`
      : n.label
  })));
  nav.innerHTML = items
    .map(
      (n) =>
        `<a href="#${n.id}" data-page="${n.id}" class="${location.hash.slice(1) === n.id || (!location.hash && n.id === 'home') ? 'active' : ''}">${n.label}</a>`
    )
    .join('');
  nav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = a.dataset.page;
      route();
    });
  });
}

async function init() {
  if (!localStorage.getItem('token')) {
    location.href = '/login.html';
    return;
  }
  try {
    const me = await api('/api/me');
    currentUser = me.user;
    currentGroup = me.group;
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('userAccount').textContent = currentUser.account;
    document.getElementById('userClass').textContent = currentUser.characterClass;
    document.getElementById('userClass').className = 'badge' + (currentUser.role === 'super_admin' ? ' admin' : '');
    document.getElementById('userGroup').textContent = `${currentGroup?.server || ''} · ${currentGroup?.name || ''}`;
    if (isAdmin()) {
      try {
        const wr = await api('/api/withdraw-requests');
        pendingWithdrawCount = wr.requests.filter((r) => r.status === '待審核').length;
      } catch { pendingWithdrawCount = 0; }
    }
    renderNav();
    route();
  } catch {
    location.href = '/login.html';
  }
}

async function route() {
  const page = location.hash.slice(1) || 'home';
  if (isAdmin()) {
    try {
      const wr = await api('/api/withdraw-requests');
      pendingWithdrawCount = wr.requests.filter((r) => r.status === '待審核').length;
    } catch { /* ignore */ }
  }
  renderNav();
  const el = document.getElementById('page');
  const pages = {
    home: renderHome,
    treasures: renderTreasures,
    settings: renderSettings,
    todos: renderTodos,
    bank: renderBank,
    'bank-overview': renderBankOverview,
    'withdraw-review': renderWithdrawReview,
    deposits: renderDeposits,
    'deposit-perms': renderDepositPerms,
    'guild-settings': renderGuildSettings,
    users: renderUsers,
    announce: renderAnnounce
  };
  const fn = pages[page] || renderHome;
  if (['deposits', 'deposit-perms', 'guild-settings', 'users', 'announce', 'withdraw-review'].includes(page) && !isAdmin()) {
    el.innerHTML = '<div class="card"><p class="error">權限不足</p></div>';
    return;
  }
  el.innerHTML = '<div class="card"><p class="muted">載入中...</p></div>';
  await fn(el);
}

async function renderHome(el) {
  const data = await api('/api/dashboard');
  el.innerHTML = `
    <h2 class="page-title">首頁</h2>
    <div class="announcement-box">
      <div class="card-title">📢 公告</div>
      ${data.announcements.map((a) => `<p>${escapeHtml(a.content)}</p>`).join('') || '<p class="muted">尚無公告</p>'}
    </div>
    <div class="card">
      <div class="card-title">📋 待辦事項</div>
      <div class="grid-3">
        <div class="todo-card blue">
          <div>我的待入帳寶物</div>
          <div class="count">${data.todos.pendingCredit}</div>
          <div>等待你完成入帳</div>
        </div>
      </div>
    </div>`;
}

async function renderTreasures(el) {
  const [treasures, guildSettings] = await Promise.all([
    api('/api/treasures'),
    api('/api/guild-settings')
  ]);

  function canEditParticipants(t) {
    if (t.status !== '待入帳') return false;
    if (isAdmin()) return true;
    return [t.holder, t.applicant, t.leader].includes(currentUser.account);
  }

  el.innerHTML = `
    <h2 class="page-title">寶物申報清單</h2>
    <div class="toolbar">
      <button class="btn primary" id="addTreasure">新增</button>
      <button class="btn" id="exportTreasures">匯出</button>
      <span class="muted">公積金 ${guildSettings.fundPercent}% · 秘書 ${guildSettings.secretaryPercent ?? 0}% · 跨服秘書 ${guildSettings.crossSecretaryPercent ?? 0}%</span>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="data-table">
        <thead><tr>
          <th>狀態</th><th>單號</th><th>BOSS</th><th>取得時間</th><th>寶物名稱</th>
          <th>持有人</th><th>參與人員</th><th>是否有參加</th><th>帶團者</th><th>入帳金額</th><th>申請時間</th><th></th>
        </tr></thead>
        <tbody>${treasures
          .map(
            (t) => {
              const joined = (t.participants || []).includes(currentUser.account);
              return `<tr>
              <td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.serial)}</td><td>${escapeHtml(t.boss)}</td>
              <td>${fmtDate(t.obtainedAt)}</td><td>${escapeHtml(t.itemName)}</td><td>${escapeHtml(t.holder)}</td>
              <td>${(t.participants || []).join(', ')}</td>
              <td>${joined ? '<span style="color:var(--success);font-weight:600">是</span>' : '否'}</td>
              <td>${escapeHtml(t.leader)}</td>
              <td>${t.creditTotal ? fmtNum(t.creditTotal) : '-'}</td>
              <td>${fmtDate(t.appliedAt)}</td>
              <td>
                ${t.status === '待入帳' && canEditParticipants(t) ? `<button class="btn btn-sm" data-edit-participants="${t.id}">編輯參與</button> ` : ''}
                ${t.status === '待入帳' && isAdmin() ? `<button class="btn primary btn-sm" data-credit="${t.id}">入帳</button> ` : ''}
                ${t.status === '待入帳' && isAdmin() ? `<button class="btn danger btn-sm" data-del-treasure="${t.id}">刪除</button> ` : ''}
                ${t.status === '已入帳' && isSuperAdmin() ? `<button class="btn danger btn-sm" data-del-treasure="${t.id}" data-credited="1">刪除</button> ` : ''}
                ${t.status === '已入帳' ? `<button class="btn btn-sm" data-detail="${t.id}">明細</button>` : ''}
              </td>
            </tr>`;
            }
          )
          .join('')}</tbody>
      </table>
    </div>
    <div id="treasureModal" class="hidden card">
      <div class="card-title">新增寶物申報</div>
      <p class="muted" style="margin-bottom:0.75rem">BOSS 與寶物名稱請直接輸入文字，無下拉選單、無需上傳圖片。</p>
      <form id="treasureForm" class="form-grid">
        <label>BOSS<input name="boss" type="text" required placeholder="直接輸入 BOSS 名稱" /></label>
        <label>寶物名稱<input name="itemName" type="text" required placeholder="直接輸入寶物名稱" /></label>
        <label>持有人<input name="holder" type="text" value="${escapeHtml(currentUser.account)}" placeholder="直接輸入持有人" /></label>
        <label>帶團者<input name="leader" type="text" value="${escapeHtml(currentUser.account)}" placeholder="直接輸入帶團者" /></label>
        <label>取得時間<input name="obtainedAt" type="datetime-local" /></label>
        ${participantPickerHtml('參與人員')}
        <div style="grid-column:1/-1"><button class="btn primary">提交申報</button></div>
      </form>
    </div>
    <div id="creditModal" class="modal hidden">
      <div class="modal-panel card">
        <div class="card-title">寶物入帳分配</div>
        <p id="creditInfo" class="muted"></p>
        <form id="creditForm">
          <label class="field-label">入帳總額<input id="creditTotal" type="number" min="1" required placeholder="輸入總金額" /></label>
          <div class="credit-summary">
            <div>公積金抽成 <strong id="creditPercent">${guildSettings.fundPercent}</strong>%</div>
            <div>公積金：<strong id="creditGuild">${fmtNum(0)}</strong></div>
            <div>秘書抽成 <strong id="creditSecretaryPercent">${guildSettings.secretaryPercent ?? 0}</strong>%</div>
            <div>秘書：<strong id="creditSecretary">${fmtNum(0)}</strong></div>
            <label class="checkbox-row" style="margin:0.5rem 0">
              <input type="checkbox" id="applyCrossSecretary" />
              跨服秘書抽成 <strong id="creditCrossPercent">${guildSettings.crossSecretaryPercent ?? 0}</strong>%
            </label>
            <div id="creditCrossRow" class="hidden">跨服秘書：<strong id="creditCross">${fmtNum(0)}</strong></div>
            <div>可分配給盟友：<strong id="creditRemain">${fmtNum(0)}</strong></div>
          </div>
          <div class="card-title" style="margin-top:1rem">盟友分配</div>
          <div id="creditRows"></div>
          <p class="muted">已分配：<strong id="creditAssigned">0</strong> / <strong id="creditTarget">0</strong></p>
          <div class="toolbar" style="margin-top:1rem">
            <button type="button" class="btn" id="creditEqual">平均分配</button>
            <button type="button" class="btn ghost" id="creditCancel">取消</button>
            <button type="submit" class="btn primary">確認入帳</button>
          </div>
        </form>
      </div>
    </div>
    <div id="detailModal" class="modal hidden">
      <div class="modal-panel card">
        <div class="card-title">入帳明細</div>
        <div id="detailContent"></div>
        <div class="toolbar" style="margin-top:1rem">
          <button type="button" class="btn primary" id="detailClose">關閉</button>
        </div>
      </div>
    </div>
    <div id="editParticipantsModal" class="modal hidden">
      <div class="modal-panel card">
        <div class="card-title">編輯參與人員</div>
        <p id="editParticipantsInfo" class="muted"></p>
        <form id="editParticipantsForm">
          ${participantPickerHtml('參與人員')}
          <p class="muted" style="font-size:0.8rem;margin-top:0.35rem">搜尋帳號後點選加入；已選人員會以標籤顯示，不會重複。僅「待入帳」狀態可修改。</p>
          <div class="toolbar" style="margin-top:1rem">
            <button type="button" class="btn ghost" id="editParticipantsCancel">取消</button>
            <button type="submit" class="btn primary">儲存</button>
          </div>
        </form>
      </div>
    </div>`;

  const treasureMap = Object.fromEntries(treasures.map((t) => [t.id, t]));
  let creditTreasure = null;

  const treasureParticipantPicker = mountParticipantPicker(
    document.querySelector('#treasureForm .participant-picker'),
    { initial: [currentUser.account] }
  );
  const editParticipantPicker = mountParticipantPicker(
    document.querySelector('#editParticipantsForm .participant-picker')
  );

  function calcCredit() {
    const total = Number(document.getElementById('creditTotal').value) || 0;
    const guildPct = Number(document.getElementById('creditPercent').textContent) || 0;
    const secPct = Number(document.getElementById('creditSecretaryPercent').textContent) || 0;
    const crossPct = Number(document.getElementById('creditCrossPercent').textContent) || 0;
    const applyCross = document.getElementById('applyCrossSecretary').checked;
    const guild = Math.round(total * guildPct / 100);
    const secretary = Math.round(total * secPct / 100);
    const cross = applyCross ? Math.round(total * crossPct / 100) : 0;
    const remain = total - guild - secretary - cross;
    document.getElementById('creditGuild').textContent = fmtNum(guild);
    document.getElementById('creditSecretary').textContent = fmtNum(secretary);
    document.getElementById('creditCross').textContent = fmtNum(cross);
    document.getElementById('creditCrossRow').classList.toggle('hidden', !applyCross);
    document.getElementById('creditRemain').textContent = fmtNum(remain);
    document.getElementById('creditTarget').textContent = fmtNum(remain);
    updateAssigned();
    return { total, guild, secretary, cross, remain, applyCross };
  }

  function updateAssigned() {
    const inputs = document.querySelectorAll('.credit-amount');
    const sum = [...inputs].reduce((s, inp) => s + (Number(inp.value) || 0), 0);
    document.getElementById('creditAssigned').textContent = fmtNum(sum);
  }

  function buildCreditRows(participants) {
    const rows = document.getElementById('creditRows');
    rows.innerHTML = participants
      .map(
        (p, i) => `
        <div class="credit-row">
          <span>${escapeHtml(p)}</span>
          <input type="number" min="0" class="credit-amount" data-account="${escapeHtml(p)}" data-idx="${i}" placeholder="金額" />
        </div>`
      )
      .join('');
    rows.querySelectorAll('.credit-amount').forEach((inp) => {
      inp.addEventListener('input', updateAssigned);
    });
  }

  function openDetailModal(t) {
    const distRows = (t.distributions || [])
      .map((d) => `<tr><td>${escapeHtml(d.account)}</td><td>${fmtNum(d.amount)}</td></tr>`)
      .join('');
    document.getElementById('detailContent').innerHTML = `
      <table class="data-table" style="margin-bottom:1rem">
        <tbody>
          <tr><td class="muted" style="width:120px">單號</td><td>${escapeHtml(t.serial)}</td></tr>
          <tr><td class="muted">BOSS</td><td>${escapeHtml(t.boss)}</td></tr>
          <tr><td class="muted">寶物名稱</td><td>${escapeHtml(t.itemName)}</td></tr>
          <tr><td class="muted">持有人</td><td>${escapeHtml(t.holder)}</td></tr>
          <tr><td class="muted">帶團者</td><td>${escapeHtml(t.leader || '-')}</td></tr>
          <tr><td class="muted">參與人員</td><td>${(t.participants || []).join(', ')}</td></tr>
          <tr><td class="muted">取得時間</td><td>${fmtDate(t.obtainedAt)}</td></tr>
          <tr><td class="muted">申請人</td><td>${escapeHtml(t.applicant || '-')}</td></tr>
          <tr><td class="muted">申請時間</td><td>${fmtDate(t.appliedAt)}</td></tr>
        </tbody>
      </table>
      <div class="card-title">入帳資訊</div>
      <table class="data-table" style="margin-bottom:1rem">
        <tbody>
          <tr><td class="muted" style="width:120px">入帳總額</td><td><strong>${fmtNum(t.creditTotal)}</strong></td></tr>
          <tr><td class="muted">公積金 (${t.guildFundPercent ?? '-'}%)</td><td>${fmtNum(t.guildFundAmount ?? 0)}</td></tr>
          <tr><td class="muted">秘書抽成 (${t.secretaryPercent ?? '-'}%)</td><td>${fmtNum(t.secretaryAmount ?? 0)}</td></tr>
          ${
            t.applyCrossSecretary
              ? `<tr><td class="muted">跨服秘書 (${t.crossSecretaryPercent ?? '-'}%)</td><td>${fmtNum(t.crossSecretaryAmount ?? 0)}</td></tr>`
              : ''
          }
          <tr><td class="muted">入帳人</td><td>${escapeHtml(t.creditedBy || '-')}</td></tr>
          <tr><td class="muted">入帳時間</td><td>${fmtDate(t.creditedAt)}</td></tr>
        </tbody>
      </table>
      <div class="card-title">盟友分配明細</div>
      <table class="data-table">
        <thead><tr><th>帳號</th><th>金額</th></tr></thead>
        <tbody>${distRows || '<tr><td colspan="2" class="empty-state">無分配紀錄</td></tr>'}</tbody>
        <tfoot><tr><td style="text-align:right;font-weight:600">合計</td><td style="font-weight:600">${fmtNum((t.distributions || []).reduce((s, d) => s + d.amount, 0))}</td></tr></tfoot>
      </table>`;
    document.getElementById('detailModal').classList.remove('hidden');
  }

  function openCreditModal(t) {
    creditTreasure = t;
    document.getElementById('creditInfo').textContent =
      `${t.serial} · ${t.itemName} · 參與：${(t.participants || []).join(', ')}`;
    document.getElementById('creditTotal').value = '';
    document.getElementById('applyCrossSecretary').checked = false;
    buildCreditRows(t.participants?.length ? t.participants : [t.holder]);
    calcCredit();
    document.getElementById('creditModal').classList.remove('hidden');
  }

  document.getElementById('addTreasure').onclick = () => {
    const modal = document.getElementById('treasureModal');
    const opening = modal.classList.contains('hidden');
    modal.classList.toggle('hidden');
    if (opening) {
      const form = document.getElementById('treasureForm');
      form.reset();
      form.holder.value = currentUser.account;
      form.leader.value = currentUser.account;
      treasureParticipantPicker?.setSelected([currentUser.account]);
    }
  };
  document.getElementById('exportTreasures').onclick = () =>
    exportCsv('treasures.csv', treasures, ['serial', 'status', 'boss', 'itemName', 'holder', 'creditTotal', 'obtainedAt']);

  document.getElementById('creditTotal').addEventListener('input', calcCredit);
  document.getElementById('applyCrossSecretary').addEventListener('change', calcCredit);
  document.getElementById('creditCancel').onclick = () => {
    document.getElementById('creditModal').classList.add('hidden');
    creditTreasure = null;
  };
  document.getElementById('creditEqual').onclick = () => {
    const { remain } = calcCredit();
    const inputs = [...document.querySelectorAll('.credit-amount')];
    if (!inputs.length || remain <= 0) return;
    const base = Math.floor(remain / inputs.length);
    let leftover = remain - base * inputs.length;
    inputs.forEach((inp, i) => {
      inp.value = base + (i < leftover ? 1 : 0);
    });
    updateAssigned();
  };

  document.getElementById('creditForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!creditTreasure) return;
    const { total, remain, applyCross } = calcCredit();
    const distributions = [...document.querySelectorAll('.credit-amount')].map((inp) => ({
      account: inp.dataset.account,
      amount: Number(inp.value) || 0
    }));
    const assigned = distributions.reduce((s, d) => s + d.amount, 0);
    if (assigned !== remain) {
      alert(`盟友分配總額 ${assigned} 需等於可分配餘額 ${remain}`);
      return;
    }
    try {
      await api('/api/treasures/' + creditTreasure.id + '/credit', {
        method: 'POST',
        body: JSON.stringify({ totalAmount: total, distributions, applyCrossSecretary: applyCross })
      });
      alert('入帳完成，金額已分配給盟友與各項抽成');
      route();
    } catch (err) {
      alert(err.message);
    }
  };

  document.getElementById('treasureForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.participants = treasureParticipantPicker?.getSelected() || [];
    if (!body.participants.length) {
      alert('至少需要一位參與人員');
      return;
    }
    await api('/api/treasures', { method: 'POST', body: JSON.stringify(body) });
    route();
  };

  el.querySelectorAll('[data-credit]').forEach((btn) => {
    btn.onclick = () => openCreditModal(treasureMap[btn.dataset.credit]);
  });
  el.querySelectorAll('[data-edit-participants]').forEach((btn) => {
    btn.onclick = () => openEditParticipantsModal(treasureMap[btn.dataset.editParticipants]);
  });
  el.querySelectorAll('[data-del-treasure]').forEach((btn) => {
    btn.onclick = async () => {
      const t = treasureMap[btn.dataset.delTreasure];
      if (!t) return;
      const credited = btn.dataset.credited === '1';
      const msg = credited
        ? `確定刪除已入帳寶物「${t.serial} · ${t.itemName}」？\n此操作會撤銷盟友入帳金額與各項抽成，且無法復原。`
        : `確定刪除寶物申報「${t.serial} · ${t.itemName}」？`;
      if (!confirm(msg)) return;
      try {
        await api('/api/treasures/' + t.id, { method: 'DELETE' });
        route();
      } catch (err) {
        alert(err.message);
      }
    };
  });
  el.querySelectorAll('[data-detail]').forEach((btn) => {
    btn.onclick = () => openDetailModal(treasureMap[btn.dataset.detail]);
  });
  document.getElementById('detailClose').onclick = () =>
    document.getElementById('detailModal').classList.add('hidden');

  let editParticipantsTreasure = null;

  function openEditParticipantsModal(t) {
    editParticipantsTreasure = t;
    document.getElementById('editParticipantsInfo').textContent =
      `${t.serial} · ${t.itemName} · 持有人：${t.holder}`;
    editParticipantPicker?.setSelected(t.participants || []);
    document.getElementById('editParticipantsModal').classList.remove('hidden');
  }

  document.getElementById('editParticipantsCancel').onclick = () => {
    document.getElementById('editParticipantsModal').classList.add('hidden');
    editParticipantsTreasure = null;
  };

  document.getElementById('editParticipantsForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!editParticipantsTreasure) return;
    const participants = editParticipantPicker?.getSelected() || [];
    if (!participants.length) {
      alert('至少需要一位參與人員');
      return;
    }
    try {
      await api('/api/treasures/' + editParticipantsTreasure.id, {
        method: 'PATCH',
        body: JSON.stringify({ participants })
      });
      document.getElementById('editParticipantsModal').classList.add('hidden');
      editParticipantsTreasure = null;
      route();
    } catch (err) {
      alert(err.message);
    }
  };
}

async function renderGuildSettings(el) {
  const settings = await api('/api/guild-settings');

  function renderHistory(history) {
    if (!history?.length) return '';
    return `<table class="data-table" style="margin-top:0.75rem">
      <thead><tr><th>時間</th><th>操作</th><th>金額</th><th>餘額</th><th>備註</th><th>操作者</th></tr></thead>
      <tbody>${history
        .slice(0, 20)
        .map(
          (h) =>
            `<tr><td>${fmtDate(h.createdAt)}</td><td>${escapeHtml(h.mode === 'set' ? '設定' : '增減')}</td><td style="color:${h.delta >= 0 ? 'var(--success)' : 'var(--danger)'}">${h.delta >= 0 ? '+' : ''}${fmtNum(h.delta)}</td><td>${fmtNum(h.balanceAfter)}</td><td>${escapeHtml(h.note)}</td><td>${escapeHtml(h.by)}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;
  }

  function renderFundCard({ title, balance, percentName, percentValue, target, note, history }) {
    return `
    <div class="card">
      <div class="card-title">${title}</div>
      <div class="muted">目前餘額</div>
      <div class="stat-big" style="margin-bottom:1rem">${fmtNum(balance)}</div>
      <form class="form-grid fund-percent-form" data-target="${target}">
        <label>${title}抽成 %<input name="${percentName}" type="number" min="0" max="100" step="0.1" value="${percentValue}" required /></label>
        <div><button class="btn primary">儲存抽成比例</button></div>
      </form>
      <p class="muted" style="margin-top:0.75rem">${note}</p>
      <div class="card-title" style="margin-top:1.25rem">調整餘額</div>
      <form class="form-grid fund-adjust-form" data-target="${target}">
        <label>調整方式
          <select name="mode">
            <option value="adjust">增減金額</option>
            <option value="set">直接設定餘額</option>
          </select>
        </label>
        <label class="fund-amount-label">增減金額（正數增加、負數減少）<input name="amount" type="number" required placeholder="例如 100 或 -50" /></label>
        <label>備註<input name="note" placeholder="調整原因" /></label>
        <div><button class="btn primary">確認調整</button></div>
      </form>
      ${history?.length ? `<div class="card-title" style="margin-top:1.25rem">調整紀錄</div>${renderHistory(history)}` : ''}
    </div>`;
  }

  el.innerHTML = `
    <h2 class="page-title">抽成設定</h2>
    <div class="grid-2">
      ${renderFundCard({
        title: '公積金',
        balance: settings.fundBalance,
        percentName: 'fundPercent',
        percentValue: settings.fundPercent,
        target: 'fund',
        note: '入帳時會自動從總額抽取此比例存入公積金。',
        history: settings.adjustHistory
      })}
      ${renderFundCard({
        title: '秘書抽成',
        balance: settings.secretaryBalance ?? 0,
        percentName: 'secretaryPercent',
        percentValue: settings.secretaryPercent ?? 0,
        target: 'secretary',
        note: '入帳時會自動從總額抽取此比例存入秘書抽成池。',
        history: settings.secretaryAdjustHistory
      })}
      ${renderFundCard({
        title: '跨服秘書抽成',
        balance: settings.crossSecretaryBalance ?? 0,
        percentName: 'crossSecretaryPercent',
        percentValue: settings.crossSecretaryPercent ?? 0,
        target: 'crossSecretary',
        note: '入帳時可勾選是否套用跨服秘書抽成；勾選後依此比例從總額扣除。',
        history: settings.crossSecretaryAdjustHistory
      })}
    </div>`;

  el.querySelectorAll('.fund-percent-form').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      await api('/api/guild-settings', { method: 'PATCH', body: JSON.stringify(body) });
      alert('抽成比例已更新');
      route();
    };
  });

  el.querySelectorAll('.fund-adjust-form').forEach((form) => {
    const modeSelect = form.querySelector('select[name=mode]');
    const amountLabel = form.querySelector('.fund-amount-label');
    modeSelect.onchange = () => {
      amountLabel.firstChild.textContent =
        modeSelect.value === 'set' ? '設定餘額為' : '增減金額（正數增加、負數減少）';
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      body.target = form.dataset.target;
      await api('/api/guild-settings/adjust', { method: 'POST', body: JSON.stringify(body) });
      alert('餘額已調整');
      route();
    };
  });
}

async function renderBank(el) {
  const data = await api('/api/bank');
  const recent = data.transactions.slice(0, 50);
  const pending = data.pendingWithdraws || [];
  const incomeEntries = Object.entries(data.income);
  const expenseEntries = Object.entries(data.expense);
  const totalIncome = incomeEntries.reduce((s, [, v]) => s + v, 0);
  const totalExpense = expenseEntries.reduce((s, [, v]) => s + v, 0);

  el.innerHTML = `
    <h2 class="page-title">個人銀行帳戶</h2>
    <div class="grid-2">
      <div class="card">
        <div class="muted">帳戶餘額</div>
        <div class="stat-big">${fmtNum(data.balance)}</div>
        ${pending.length ? `<p class="muted">待審核提領 ${fmtNum(pending.reduce((s, r) => s + r.amount, 0))} · 可用 ${fmtNum(data.availableBalance ?? data.balance)}</p>` : ''}
        <div class="toolbar" style="margin-top:1rem">
          <button class="btn primary" id="withdrawBtn">申請提領</button>
          <button class="btn" id="transferBtn">轉帳</button>
        </div>
        <p class="muted" style="margin-top:0.5rem;font-size:0.8rem">提領需管理員審核通過後才會扣款</p>
      </div>
      <div class="card">
        <div class="card-title">餘額走勢</div>
        <div class="chart-wrap"><canvas id="balanceChart"></canvas></div>
      </div>
    </div>
    ${
      pending.length
        ? `<div class="card">
      <div class="card-title">待審核提領</div>
      <table class="data-table">
        <thead><tr><th>金額</th><th>備註</th><th>申請時間</th><th>狀態</th></tr></thead>
        <tbody>${pending.map((r) => `<tr><td>${fmtNum(r.amount)}</td><td>${escapeHtml(r.note || '-')}</td><td>${fmtDate(r.createdAt)}</td><td>${escapeHtml(r.status)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`
        : ''
    }
    <div class="grid-2">
      <div class="card">
        <div class="card-title">收入構成 · 累計 ${fmtNum(totalIncome)}</div>
        ${incomeEntries.map(([k, v]) => `<div>${escapeHtml(k)}: ${fmtNum(v)} (${totalIncome ? Math.round((v / totalIncome) * 100) : 0}%)</div>`).join('') || '<p class="muted">尚無收入</p>'}
      </div>
      <div class="card">
        <div class="card-title">支出構成 · 累計 ${fmtNum(totalExpense)}</div>
        ${expenseEntries.map(([k, v]) => `<div>${escapeHtml(k)}: ${fmtNum(v)} (${totalExpense ? Math.round((v / totalExpense) * 100) : 0}%)</div>`).join('') || '<p class="muted">尚無支出</p>'}
      </div>
    </div>
    <div class="card">
      <div class="card-title">近期異動 · 最近 50 筆</div>
      <table class="data-table">
        <thead><tr><th>類型</th><th>時間</th><th>單號</th><th>金額</th></tr></thead>
        <tbody>${recent
          .map(
            (t) =>
              `<tr><td>${escapeHtml(t.type)}</td><td>${fmtDate(t.createdAt)}</td><td>${escapeHtml(t.ref)}</td><td style="color:${t.amount >= 0 ? 'var(--success)' : 'var(--danger)'}">${t.amount >= 0 ? '+' : ''}${fmtNum(t.amount)}</td></tr>`
          )
          .join('')}</tbody>
      </table>
    </div>`;

  // Chart
  const sorted = [...data.transactions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let running = 0;
  const points = sorted.map((t) => {
    running += t.amount;
    return { x: t.createdAt.slice(0, 10), y: running };
  });
  if (balanceChart) balanceChart.destroy();
  const ctx = document.getElementById('balanceChart');
  if (ctx && points.length) {
    balanceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: points.map((p) => p.x),
        datasets: [{ label: '餘額', data: points.map((p) => p.y), borderColor: '#2563eb', tension: 0.3, fill: false }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  document.getElementById('withdrawBtn').onclick = async () => {
    const amount = prompt('提領金額（送出後需管理員審核）');
    if (!amount) return;
    try {
      await api('/api/bank/withdraw', { method: 'POST', body: JSON.stringify({ amount: Number(amount) }) });
      alert('提領申請已送出，等待管理員審核');
      route();
    } catch (e) {
      alert(e.message);
    }
  };
  document.getElementById('transferBtn').onclick = async () => {
    const toAccount = prompt('收款帳號');
    const amount = prompt('轉帳金額');
    if (!toAccount || !amount) return;
    try {
      await api('/api/bank/transfer', { method: 'POST', body: JSON.stringify({ toAccount, amount: Number(amount) }) });
      alert('轉帳成功');
      route();
    } catch (e) {
      alert(e.message);
    }
  };
}

async function renderBankOverview(el) {
  const data = await api('/api/bank/overview');
  const adjustments = isAdmin() ? (await api('/api/bank/adjustments')).records : [];
  el.innerHTML = `
    <h2 class="page-title">所有帳號餘額總覽</h2>
    <div class="grid-3">
      <div class="card">
        <div class="muted">成員銀行合計</div>
        <div class="stat-big">${fmtNum(data.memberTotal)}</div>
        <p class="muted">${data.count} 位成員</p>
      </div>
      <div class="card">
        <div class="muted">公積金</div>
        <div class="stat-big">${fmtNum(data.guildFundBalance)}</div>
      </div>
      <div class="card">
        <div class="muted">秘書抽成</div>
        <div class="stat-big">${fmtNum(data.secretaryBalance ?? 0)}</div>
      </div>
      <div class="card">
        <div class="muted">跨服秘書抽成</div>
        <div class="stat-big">${fmtNum(data.crossSecretaryBalance ?? 0)}</div>
      </div>
      <div class="card">
        <div class="muted">全系統合計</div>
        <div class="stat-big">${fmtNum(data.grandTotal)}</div>
        <p class="muted">成員 + 公積金 + 秘書 + 跨服秘書${data.depositTotal ? ' + 儲值池 ' + fmtNum(data.depositTotal) : ''}</p>
      </div>
    </div>
    ${
      isAdmin()
        ? `<div class="card">
      <div class="card-title">管理員調整</div>
      <form id="adjustForm" class="form-grid">
        <label>帳號<input name="account" required placeholder="成員帳號" list="overviewAccounts" /></label>
        <datalist id="overviewAccounts">${data.accounts.map((a) => `<option value="${escapeHtml(a.account)}">`).join('')}</datalist>
        <label>類型<select name="type"><option>調整</option><option>儲值</option><option>扣薪入帳</option><option>寶物收入</option></select></label>
        <label>金額<input name="amount" type="number" required /></label>
        <label>備註<input name="note" /></label>
        <div><button class="btn primary">執行</button></div>
      </form>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <div class="card-title" style="padding:1rem 1rem 0">調整明細</div>
      <div class="toolbar" style="padding:0 1rem 0.75rem">
        <input id="adjustSearch" type="search" placeholder="搜尋帳號、類型、備註、操作者..." style="flex:1;min-width:180px;padding:0.55rem 0.75rem;border:1px solid var(--border);border-radius:8px" />
        <select id="adjustTypeFilter" style="padding:0.55rem 0.75rem;border:1px solid var(--border);border-radius:8px">
          <option value="">全部類型</option>
          <option>調整</option>
          <option>儲值</option>
          <option>扣薪入帳</option>
          <option>寶物收入</option>
        </select>
        <button class="btn" id="exportAdjustments">匯出</button>
      </div>
      <table class="data-table" id="adjustTable">
        <thead><tr><th>時間</th><th>帳號</th><th>類型</th><th>金額</th><th>備註</th><th>操作者</th></tr></thead>
        <tbody>${adjustments.length
          ? adjustments
              .map(
                (r) =>
                  `<tr data-search="${escapeHtml(`${r.account} ${r.type} ${r.note} ${r.adjustedBy}`)}" data-type="${escapeHtml(r.type)}">
                    <td>${fmtDate(r.createdAt)}</td>
                    <td>${escapeHtml(r.account)}</td>
                    <td>${escapeHtml(r.type)}</td>
                    <td style="color:${r.amount >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600">${r.amount >= 0 ? '+' : ''}${fmtNum(r.amount)}</td>
                    <td>${escapeHtml(r.note || '-')}</td>
                    <td>${escapeHtml(r.adjustedBy)}</td>
                  </tr>`
              )
              .join('')
          : '<tr><td colspan="6" class="empty-state">尚無管理員調整紀錄</td></tr>'
        }</tbody>
      </table>
    </div>`
        : ''
    }
    <div class="toolbar">
      <input id="balanceSearch" type="search" placeholder="搜尋帳號、血盟、職業..." style="flex:1;min-width:180px;padding:0.55rem 0.75rem;border:1px solid var(--border);border-radius:8px" />
      <button class="btn" id="exportOverview">匯出</button>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="data-table" id="overviewTable">
        <thead><tr><th>#</th><th>帳號</th><th>血盟</th><th>職業</th><th>職務</th><th>餘額</th></tr></thead>
        <tbody>${data.accounts
          .map(
            (a, i) =>
              `<tr data-search="${escapeHtml(`${a.account} ${a.clan} ${a.characterClass} ${a.systemTitle}`)}">
                <td>${i + 1}</td>
                <td>${escapeHtml(a.account)}</td>
                <td>${escapeHtml(a.clan)}</td>
                <td>${escapeHtml(a.characterClass)}</td>
                <td>${escapeHtml(a.systemTitle)}</td>
                <td style="font-weight:600;color:${a.balance >= 0 ? 'var(--primary)' : 'var(--danger)'}">${fmtNum(a.balance)}</td>
              </tr>`
          )
          .join('')}</tbody>
        <tfoot><tr><td colspan="5" style="text-align:right;font-weight:700">合計</td><td style="font-weight:700">${fmtNum(data.memberTotal)}</td></tr></tfoot>
      </table>
    </div>`;

  document.getElementById('balanceSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('#overviewTable tbody tr').forEach((row) => {
      row.style.display = !q || row.dataset.search.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  document.getElementById('exportOverview').onclick = () =>
    exportCsv('balances.csv', data.accounts, ['account', 'clan', 'characterClass', 'systemTitle', 'balance']);

  const adjustForm = document.getElementById('adjustForm');
  if (adjustForm) {
    adjustForm.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.account = String(body.account || '').trim();
      try {
        await api('/api/bank/adjust', { method: 'POST', body: JSON.stringify(body) });
        alert('調整完成');
        route();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const adjustSearch = document.getElementById('adjustSearch');
  const adjustTypeFilter = document.getElementById('adjustTypeFilter');
  function filterAdjustments() {
    if (!adjustSearch) return;
    const q = adjustSearch.value.trim().toLowerCase();
    const type = adjustTypeFilter?.value || '';
    el.querySelectorAll('#adjustTable tbody tr[data-search]').forEach((row) => {
      const matchQ = !q || row.dataset.search.toLowerCase().includes(q);
      const matchType = !type || row.dataset.type === type;
      row.style.display = matchQ && matchType ? '' : 'none';
    });
  }
  if (adjustSearch) adjustSearch.oninput = filterAdjustments;
  if (adjustTypeFilter) adjustTypeFilter.onchange = filterAdjustments;
  const exportAdjustments = document.getElementById('exportAdjustments');
  if (exportAdjustments) {
    exportAdjustments.onclick = () =>
      exportCsv('bank-adjustments.csv', adjustments, ['createdAt', 'account', 'type', 'amount', 'note', 'adjustedBy']);
  }
}

async function renderWithdrawReview(el) {
  const data = await api('/api/withdraw-requests');
  const pending = data.requests.filter((r) => r.status === '待審核');
  const history = data.requests.filter((r) => r.status !== '待審核');

  el.innerHTML = `
    <h2 class="page-title">提領審核</h2>
    <div class="card">
      <div class="muted">待審核</div>
      <div class="stat-big">${pending.length}</div>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <div class="card-title" style="padding:1rem 1rem 0">待審核申請</div>
      <table class="data-table">
        <thead><tr><th>帳號</th><th>職業</th><th>金額</th><th>備註</th><th>申請時間</th><th></th></tr></thead>
        <tbody>${
          pending.length
            ? pending
                .map(
                  (r) => `<tr>
                    <td>${escapeHtml(r.account)}</td>
                    <td>${escapeHtml(r.characterClass || '-')}</td>
                    <td style="font-weight:600">${fmtNum(r.amount)}</td>
                    <td>${escapeHtml(r.note || '-')}</td>
                    <td>${fmtDate(r.createdAt)}</td>
                    <td>
                      <button class="btn primary btn-sm" data-approve="${r.id}">核准</button>
                      <button class="btn danger btn-sm" data-reject="${r.id}">拒絕</button>
                    </td>
                  </tr>`
                )
                .join('')
            : '<tr><td colspan="6" class="empty-state">目前沒有待審核的提領申請</td></tr>'
        }</tbody>
      </table>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <div class="card-title" style="padding:1rem 1rem 0">審核紀錄</div>
      <table class="data-table">
        <thead><tr><th>帳號</th><th>金額</th><th>狀態</th><th>審核人</th><th>時間</th><th>備註</th></tr></thead>
        <tbody>${
          history.length
            ? history
                .slice(0, 50)
                .map(
                  (r) =>
                    `<tr><td>${escapeHtml(r.account)}</td><td>${fmtNum(r.amount)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.reviewedBy || '-')}</td><td>${fmtDate(r.reviewedAt || r.createdAt)}</td><td>${escapeHtml(r.rejectReason || r.note || '-')}</td></tr>`
                )
                .join('')
            : '<tr><td colspan="6" class="empty-state">尚無審核紀錄</td></tr>'
        }</tbody>
      </table>
    </div>`;

  el.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('確定核准此提領申請？核准後將從帳戶扣款。')) return;
      try {
        await api('/api/withdraw-requests/' + btn.dataset.approve + '/approve', { method: 'POST', body: '{}' });
        alert('已核准');
        route();
      } catch (e) {
        alert(e.message);
      }
    };
  });
  el.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.onclick = async () => {
      const reason = prompt('拒絕原因（選填）');
      if (reason === null) return;
      try {
        await api('/api/withdraw-requests/' + btn.dataset.reject + '/reject', {
          method: 'POST',
          body: JSON.stringify({ reason: reason || '' })
        });
        alert('已拒絕');
        route();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

async function renderDeposits(el) {
  const data = await api('/api/deposits');
  el.innerHTML = `
    <h2 class="page-title">儲值系統</h2>
    <div class="card"><div class="muted">目前總金額</div><div class="stat-big">${fmtNum(data.total)}</div></div>
    <div class="toolbar"><button class="btn primary" id="addDeposit">新增儲值</button></div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="data-table">
        <thead><tr><th>#</th><th>帳號</th><th>餘額</th></tr></thead>
        <tbody>${data.accounts
          .map((a, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(a.account)}</td><td>${fmtNum(a.balance)}</td></tr>`)
          .join('')}</tbody>
      </table>
    </div>`;
  document.getElementById('addDeposit').onclick = async () => {
    const account = prompt('帳號');
    const amount = prompt('儲值金額');
    if (!account || !amount) return;
    await api('/api/deposits', { method: 'POST', body: JSON.stringify({ account, amount: Number(amount) }) });
    route();
  };
}

async function renderDepositPerms(el) {
  const list = await api('/api/deposit-permissions');
  el.innerHTML = `
    <h2 class="page-title">儲值權限設定</h2>
    <div class="toolbar"><button class="btn primary" id="addPerm">開通</button></div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="data-table">
        <thead><tr><th>#</th><th>帳號</th><th>職業</th><th>血盟</th></tr></thead>
        <tbody>${list.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.account)}</td><td>${escapeHtml(p.class)}</td><td>${escapeHtml(p.clan)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  document.getElementById('addPerm').onclick = async () => {
    const account = prompt('成員帳號');
    if (!account) return;
    await api('/api/deposit-permissions', { method: 'POST', body: JSON.stringify({ account }) });
    route();
  };
}

async function renderUsers(el) {
  const users = await api('/api/users');
  el.innerHTML = `
    <h2 class="page-title">成員管理</h2>
    <div class="toolbar"><button class="btn primary" id="addUser">＋ 新增成員</button></div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="data-table">
        <thead><tr><th>帳號</th><th>血盟</th><th>職業</th><th>職務</th><th>使用權限</th><th></th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr>
              <td>${escapeHtml(u.account)}</td>
              <td>${escapeHtml(u.clan)}</td>
              <td>${escapeHtml(u.characterClass)}</td>
              <td>${escapeHtml(u.systemTitle)}</td>
              <td><span class="badge${u.role === 'super_admin' || u.role === 'admin' ? ' admin' : ''}">${ROLE_LABELS[u.role] || u.role}</span></td>
              <td>
                ${u.role !== 'super_admin' || currentUser.role === 'super_admin' ? `<button class="btn btn-sm" data-edit="${u.id}">編輯</button>` : ''}
                ${u.role !== 'super_admin' || currentUser.role === 'super_admin' ? `<button class="btn btn-sm" data-reset="${u.id}">重置密碼</button>` : ''}
                ${u.id !== currentUser.id && u.role !== 'super_admin' ? `<button class="btn danger btn-sm" data-del="${u.id}">刪除</button>` : ''}
              </td>
            </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>
    ${
      currentUser.role === 'super_admin'
        ? `<div class="card" style="margin-top:1rem">
      <div class="card-title">📦 資料備份／還原</div>
      <p class="muted">重新部署前請先下載備份。還原會覆蓋目前網站所有資料（成員、寶物、銀行紀錄等）。</p>
      <div class="toolbar">
        <button type="button" class="btn" id="downloadBackup">下載備份 JSON</button>
        <label class="btn" style="cursor:pointer">
          上傳並還原
          <input type="file" id="uploadRestore" accept=".json,application/json" hidden />
        </label>
      </div>
    </div>
    <div class="card" style="margin-top:1rem;border-color:var(--danger)">
      <div class="card-title">⚠️ 一鍵清零資料</div>
      <p class="muted">清除寶物、銀行、提領、公告、儲值、公積金／抽成餘額等營運資料。<strong>成員帳號（帳號、密碼、權限、血盟、職業）會完整保留。</strong></p>
      <div class="toolbar">
        <button type="button" class="btn danger" id="clearAllData">一鍵清零資料</button>
      </div>
    </div>`
        : ''
    }
    <div id="userModal" class="modal hidden">
      <div class="modal-panel card">
        <div class="card-title" id="userModalTitle">新增成員</div>
        <form id="userForm" class="form-grid">
          <input type="hidden" name="userId" id="userId" />
          <label>帳號<input name="account" required placeholder="可修改帳號名稱" /></label>
          <label>密碼<input name="password" type="password" placeholder="新增必填，編輯留空則不變" /></label>
          <label>血盟<input name="clan" value="女妖" /></label>
          <label>職業<input name="characterClass" value="王族" /></label>
          <label>職務<input name="systemTitle" placeholder="選填，依權限自動帶入" /></label>
          <label>使用權限<select name="role" id="userRole">${roleOptions()}</select></label>
          <div style="grid-column:1/-1" class="muted" style="font-size:0.8rem">
            一般會員：查看功能｜儲值管理：儲值系統｜管理員：寶物/銀行/公告/成員｜最高管理員：全部權限
          </div>
          <div style="grid-column:1/-1" class="toolbar">
            <button type="button" class="btn ghost" id="userCancel">取消</button>
            <button type="submit" class="btn primary">儲存</button>
          </div>
        </form>
      </div>
    </div>`;

  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  function openUserModal(user = null) {
    const form = document.getElementById('userForm');
    form.reset();
    document.getElementById('userModalTitle').textContent = user ? '編輯成員' : '新增成員';
    document.getElementById('userId').value = user?.id || '';
    if (user) {
      form.account.readOnly = false;
      form.account.disabled = false;
      form.account.value = user.account;
      form.clan.value = user.clan;
      form.characterClass.value = user.characterClass;
      form.systemTitle.value = user.systemTitle;
      form.role.innerHTML = roleOptions(user.role);
      form.password.required = false;
    } else {
      form.role.innerHTML = roleOptions('member');
      form.password.required = true;
      form.password.placeholder = '至少 4 字';
    }
    document.getElementById('userModal').classList.remove('hidden');
  }

  document.getElementById('addUser').onclick = () => openUserModal();
  document.getElementById('userCancel').onclick = () => document.getElementById('userModal').classList.add('hidden');

  const downloadBackup = document.getElementById('downloadBackup');
  if (downloadBackup) {
    downloadBackup.onclick = async () => {
      try {
        const data = await api('/api/admin/backup');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `lineage-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const uploadRestore = document.getElementById('uploadRestore');
  if (uploadRestore) {
    uploadRestore.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!confirm('確定還原備份？這會覆蓋目前所有資料。')) {
        e.target.value = '';
        return;
      }
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const store = json.store || json;
        await api('/api/admin/restore', { method: 'POST', body: JSON.stringify({ store }) });
        alert('資料已還原，請重新整理頁面');
        location.reload();
      } catch (err) {
        alert(err.message || '還原失敗');
      }
      e.target.value = '';
    };
  }

  const clearAllData = document.getElementById('clearAllData');
  if (clearAllData) {
    clearAllData.onclick = async () => {
      if (
        !confirm(
          '確定要清零所有營運資料？\n\n將清除：寶物申報、銀行紀錄、提領、公告、儲值、公積金／抽成餘額等。\n成員帳號會保留。\n\n此操作無法復原，建議先下載備份。'
        )
      ) {
        return;
      }
      const typed = prompt('請輸入「清零」以確認執行：');
      if (typed !== '清零') {
        if (typed !== null) alert('確認文字不正確，已取消');
        return;
      }
      try {
        const result = await api('/api/admin/clear-data', {
          method: 'POST',
          body: JSON.stringify({ confirm: 'CLEAR_ALL_DATA' })
        });
        alert(`${result.message}\n保留 ${result.usersKept} 位成員帳號`);
        location.reload();
      } catch (err) {
        alert(err.message || '清零失敗');
      }
    };
  }

  document.getElementById('userForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    const userId = body.userId;
    delete body.userId;
    body.account = String(body.account || '').trim();
    if (!body.account) {
      alert('請輸入帳號');
      return;
    }
    if (!body.password) delete body.password;
    try {
      if (userId) {
        const updated = await api('/api/users/' + userId, { method: 'PATCH', body: JSON.stringify(body) });
        if (userId === currentUser.id && updated.account) {
          currentUser.account = updated.account;
          document.getElementById('userAccount').textContent = updated.account;
        }
      } else {
        if (!body.password || body.password.length < 4) {
          alert('新成員密碼至少 4 字');
          return;
        }
        await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
      }
      document.getElementById('userModal').classList.add('hidden');
      route();
    } catch (err) {
      alert(err.message);
    }
  };

  el.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => openUserModal(userMap[btn.dataset.edit]);
  });

  el.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.onclick = async () => {
      const u = userMap[btn.dataset.reset];
      if (!confirm(`確定將「${u.account}」的密碼重置為 1234？`)) return;
      try {
        await api('/api/users/' + btn.dataset.reset + '/reset-password', { method: 'POST', body: '{}' });
        alert(`「${u.account}」密碼已重置為 1234`);
      } catch (err) {
        alert(err.message);
      }
    };
  });

  el.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      const u = userMap[btn.dataset.del];
      if (!confirm(`確定刪除成員「${u.account}」？`)) return;
      try {
        await api('/api/users/' + btn.dataset.del, { method: 'DELETE' });
        route();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

async function renderAnnounce(el) {
  const list = await api('/api/announcements');
  el.innerHTML = `
    <h2 class="page-title">公告管理</h2>
    <div class="card">
      <form id="annForm">
        <label>新公告<textarea name="content" required placeholder="輸入公告內容"></textarea></label>
        <button class="btn primary" style="margin-top:0.5rem">發布</button>
      </form>
    </div>
    <div class="card">${list.map((a) => `<p>${escapeHtml(a.content)}<br><small class="muted">${fmtDate(a.createdAt)}</small></p>`).join('')}</div>`;
  document.getElementById('annForm').onsubmit = async (e) => {
    e.preventDefault();
    await api('/api/announcements', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    route();
  };
}

async function renderSettings(el) {
  const data = await api('/api/settings');
  el.innerHTML = `
    <h2 class="page-title">個人設定</h2>
    <div class="grid-2">
      <div class="card">
        <div class="card-title">身份資訊</div>
        <p>角色名稱：${escapeHtml(data.user.account)}</p>
        <p>職業：${escapeHtml(data.user.characterClass)}</p>
        <p>血盟：${escapeHtml(data.user.clan)}</p>
        <p>系統職務：${escapeHtml(data.user.systemTitle)}</p>
        <p>權限等級：<strong>${ROLE_LABELS[data.user.role] || data.user.role}</strong></p>
      </div>
      <div class="card">
        <div class="card-title">密碼與登入</div>
        <form id="pwdForm">
          <label>新密碼（至少 4 字）<input name="password" type="password" minlength="4" required /></label>
          <button class="btn primary" style="margin-top:0.5rem">更改密碼</button>
        </form>
      </div>
    </div>
    <div class="card">
      <div class="card-title">常用名單</div>
      ${data.favoriteLists
        .map((f) => `<p><strong>${escapeHtml(f.name)}</strong>：${f.members.length ? f.members.join(', ') : '尚未加入成員'}</p>`)
        .join('')}
    </div>`;
  document.getElementById('pwdForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    await api('/api/settings/password', { method: 'POST', body: JSON.stringify(body) });
    alert('密碼已更新，請重新登入');
    localStorage.removeItem('token');
    location.href = '/login.html';
  };
}

async function renderTodos(el) {
  const data = await api('/api/todos');
  el.innerHTML = `
    <h2 class="page-title">待辦清單</h2>
    <p class="muted">共 ${data.count} 筆待處理</p>
    <div class="todo-card blue" style="max-width:320px;margin-bottom:1rem">
      <div>我的待入帳寶物</div><div class="count">${data.count}</div>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="data-table">
        <thead><tr><th>單號</th><th>寶物</th><th>BOSS</th><th>狀態</th><th>申請時間</th></tr></thead>
        <tbody>${
          data.pendingCredit.length
            ? data.pendingCredit
                .map(
                  (t) =>
                    `<tr><td>${escapeHtml(t.serial)}</td><td>${escapeHtml(t.itemName)}</td><td>${escapeHtml(t.boss)}</td><td>${escapeHtml(t.status)}</td><td>${fmtDate(t.appliedAt)}</td></tr>`
                )
                .join('')
            : '<tr><td colspan="5" class="empty-state">🎉 你目前沒有待入帳的寶物</td></tr>'
        }</tbody>
      </table>
    </div>`;
}

document.getElementById('logoutBtn').onclick = async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('token');
  location.href = '/login.html';
};

document.getElementById('menuBtn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
window.addEventListener('hashchange', route);
init();
