import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readStore, updateStore, generateSerial, writeStore, DEFAULT_STORE, PRODUCTION_FILE } from './db.js';
import {
  verifyPassword,
  createSession,
  destroySession,
  getSessionUser,
  getTokenFromRequest,
  hasPermission,
  sanitizeUser,
  hashPassword,
  ROLE_LABELS
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(__dirname, '..'));
const PUBLIC = path.resolve(path.join(ROOT, 'public'));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('limit', reject);
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function getUserBalance(store, userId) {
  return store.bankTransactions
    .filter((t) => t.userId === userId)
    .reduce((sum, t) => sum + t.amount, 0);
}

function ensureGuildSettings(store) {
  if (!store.guildSettings) {
    store.guildSettings = {
      fundPercent: 10,
      fundBalance: 0,
      adjustHistory: [],
      secretaryPercent: 0,
      secretaryBalance: 0,
      secretaryAdjustHistory: [],
      crossSecretaryPercent: 0,
      crossSecretaryBalance: 0,
      crossSecretaryAdjustHistory: []
    };
  }
  const gs = store.guildSettings;
  if (!gs.adjustHistory) gs.adjustHistory = [];
  if (gs.secretaryPercent === undefined) gs.secretaryPercent = 0;
  if (gs.secretaryBalance === undefined) gs.secretaryBalance = 0;
  if (!gs.secretaryAdjustHistory) gs.secretaryAdjustHistory = [];
  if (gs.crossSecretaryPercent === undefined) gs.crossSecretaryPercent = 0;
  if (gs.crossSecretaryBalance === undefined) gs.crossSecretaryBalance = 0;
  if (!gs.crossSecretaryAdjustHistory) gs.crossSecretaryAdjustHistory = [];
  return gs;
}

function reverseTreasureCredit(store, t) {
  ensureGuildSettings(store);
  const ref = `#${t.serial}`;
  store.bankTransactions = (store.bankTransactions || []).filter(
    (tx) => tx.treasureId !== t.id && !(tx.type === '寶物收入' && tx.ref === ref)
  );
  const gs = store.guildSettings;
  gs.fundBalance -= t.guildFundAmount || 0;
  gs.secretaryBalance -= t.secretaryAmount || 0;
  gs.crossSecretaryBalance -= t.crossSecretaryAmount || 0;
}

function getPendingWithdrawTotal(store, userId) {
  return (store.withdrawRequests || [])
    .filter((r) => r.userId === userId && r.status === '待審核')
    .reduce((s, r) => s + r.amount, 0);
}

function getAvailableBalance(store, userId) {
  return getUserBalance(store, userId) - getPendingWithdrawTotal(store, userId);
}

function findUserByAccount(store, account) {
  return store.users.find((u) => u.account === account);
}

function renameAccountReferences(store, oldAccount, newAccount) {
  if (!oldAccount || !newAccount || oldAccount === newAccount) return;

  const replaceInList = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      if (list[i] === oldAccount) list[i] = newAccount;
    }
  };

  for (const t of store.treasures || []) {
    if (t.holder === oldAccount) t.holder = newAccount;
    if (t.leader === oldAccount) t.leader = newAccount;
    if (t.applicant === oldAccount) t.applicant = newAccount;
    if (t.creditedBy === oldAccount) t.creditedBy = newAccount;
    replaceInList(t.participants);
    for (const d of t.distributions || []) {
      if (d.account === oldAccount) d.account = newAccount;
    }
  }

  for (const r of store.withdrawRequests || []) {
    if (r.account === oldAccount) r.account = newAccount;
    if (r.reviewedBy === oldAccount) r.reviewedBy = newAccount;
  }

  for (const a of store.depositAccounts || []) {
    if (a.account === oldAccount) a.account = newAccount;
  }

  for (const f of store.favoriteLists || []) {
    replaceInList(f.members);
  }

  for (const tx of store.bankTransactions || []) {
    if (typeof tx.ref === 'string') {
      tx.ref = tx.ref
        .replaceAll(`轉至 ${oldAccount}`, `轉至 ${newAccount}`)
        .replaceAll(`來自 ${oldAccount}`, `來自 ${newAccount}`);
    }
  }

  const history = store.guildSettings?.adjustHistory;
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h.by === oldAccount) h.by = newAccount;
    }
  }
}

function requireAuth(req, res) {
  const user = getSessionUser(getTokenFromRequest(req));
  if (!user) {
    sendJson(res, 401, { error: '未登入' });
    return null;
  }
  return user;
}

function requireSuperAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'super_admin') {
    sendJson(res, 403, { error: '僅最高管理員可操作' });
    return null;
  }
  return user;
}

function mergeStoreData(incoming) {
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.users)) {
    return null;
  }
  return {
    ...DEFAULT_STORE,
    ...incoming,
    groups: incoming.groups || DEFAULT_STORE.groups,
    users: incoming.users,
    announcements: incoming.announcements || [],
    events: incoming.events || [],
    treasures: incoming.treasures || [],
    bankTransactions: incoming.bankTransactions || [],
    withdrawRequests: incoming.withdrawRequests || [],
    dkpRecords: incoming.dkpRecords || [],
    dkpSettings: { ...DEFAULT_STORE.dkpSettings, ...(incoming.dkpSettings || {}) },
    guildSettings: { ...DEFAULT_STORE.guildSettings, ...(incoming.guildSettings || {}) },
    depositAccounts: incoming.depositAccounts || [],
    depositPermissions: incoming.depositPermissions || [],
    notifications: incoming.notifications || [],
    favoriteLists: incoming.favoriteLists || [],
    sessions: incoming.sessions || {}
  };
}

function buildClearedStore(store) {
  return {
    ...DEFAULT_STORE,
    users: store.users,
    sessions: store.sessions || {},
    groups: store.groups || []
  };
}

function requirePerm(req, res, permission) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!hasPermission(user, permission)) {
    sendJson(res, 403, { error: '權限不足' });
    return null;
  }
  return user;
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];

  if (urlPath === '/' || urlPath === '') {
    res.writeHead(302, { Location: '/login.html' });
    return res.end();
  }
  if (urlPath === '/login') {
    res.writeHead(302, { Location: '/login.html' });
    return res.end();
  }

  const relative = urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC, relative);
  if (filePath !== PUBLIC && !filePath.startsWith(PUBLIC + path.sep)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const ext = path.extname(filePath);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (ext === '.html' || ext === '.js') {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // Auth
  if (pathname === '/api/login' && method === 'POST') {
    const body = await parseBody(req);
    const store = readStore();
    const account = String(body.account || '').trim();
    const user = store.users.find((u) => u.account === account);
    if (!user || !verifyPassword(body.password || '', user.password)) {
      return sendJson(res, 401, { error: '登入失敗，請確認帳號與密碼' });
    }
    const token = createSession(user.id);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`
    });
    return res.end(JSON.stringify({ user: sanitizeUser(user), token }));
  }

  if (pathname === '/api/logout' && method === 'POST') {
    destroySession(getTokenFromRequest(req));
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'session=; Path=/; HttpOnly; Max-Age=0'
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const group = store.groups.find((g) => g.id === user.groupId);
    return sendJson(res, 200, {
      user: sanitizeUser(user),
      group,
      balance: getUserBalance(store, user.id)
    });
  }

  // Dashboard
  if (pathname === '/api/dashboard' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const pendingTreasures = store.treasures.filter(
      (t) => t.holder === user.account && t.status === '待入帳'
    );
    return sendJson(res, 200, {
      announcements: store.announcements.filter((a) => a.active),
      todos: {
        pendingCredit: pendingTreasures.length
      }
    });
  }

  // Announcements
  if (pathname === '/api/announcements' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    return sendJson(res, 200, readStore().announcements.filter((a) => a.active));
  }

  if (pathname === '/api/announcements' && method === 'POST') {
    const user = requirePerm(req, res, 'announcements.manage');
    if (!user) return;
    const body = await parseBody(req);
    updateStore((store) => {
      store.announcements.unshift({
        id: 'a' + Date.now(),
        content: body.content,
        active: true,
        createdAt: new Date().toISOString()
      });
    });
    return sendJson(res, 201, { ok: true });
  }

  // Treasures
  if (pathname === '/api/treasures' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    return sendJson(res, 200, readStore().treasures.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  if (pathname === '/api/treasures' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await parseBody(req);
    const treasure = {
      id: 't' + Date.now(),
      serial: generateSerial(),
      boss: body.boss,
      obtainedAt: body.obtainedAt || new Date().toISOString(),
      itemName: body.itemName,
      holder: body.holder || user.account,
      participants: body.participants || [user.account],
      leader: body.leader || user.account,
      status: body.status || '待入帳',
      applicant: user.account,
      appliedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    updateStore((store) => store.treasures.unshift(treasure));
    return sendJson(res, 201, treasure);
  }

  if (pathname.match(/^\/api\/treasures\/[^/]+\/credit$/) && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const id = pathname.split('/')[3];
    const body = await parseBody(req);
    const totalAmount = Number(body.totalAmount);
    const distributions = Array.isArray(body.distributions) ? body.distributions : [];

    if (!totalAmount || totalAmount <= 0) {
      return sendJson(res, 400, { error: '請輸入有效的入帳總額' });
    }
    if (!distributions.length) {
      return sendJson(res, 400, { error: '請分配金額給參與盟友' });
    }

    let updated;
    let creditError = null;

    updateStore((store) => {
      ensureGuildSettings(store);
      const idx = store.treasures.findIndex((t) => t.id === id);
      if (idx < 0) {
        creditError = '找不到寶物';
        return;
      }
      const t = store.treasures[idx];
      if (!hasPermission(user, 'treasures.manage')) {
        creditError = '僅管理員可執行入帳';
        return;
      }
      if (t.status !== '待入帳') {
        creditError = '目前狀態不可入帳';
        return;
      }

      const percent = Number(store.guildSettings.fundPercent) || 0;
      const secretaryPercent = Number(store.guildSettings.secretaryPercent) || 0;
      const crossSecretaryPercent = Number(store.guildSettings.crossSecretaryPercent) || 0;
      const applyCrossSecretary = !!body.applyCrossSecretary;

      const guildFundAmount = Math.round(totalAmount * percent / 100);
      const secretaryAmount = Math.round(totalAmount * secretaryPercent / 100);
      const crossSecretaryAmount = applyCrossSecretary
        ? Math.round(totalAmount * crossSecretaryPercent / 100)
        : 0;
      const distributable = totalAmount - guildFundAmount - secretaryAmount - crossSecretaryAmount;

      const normalized = distributions.map((d) => ({
        account: String(d.account || '').trim(),
        amount: Number(d.amount)
      }));

      if (normalized.some((d) => !d.account || !d.amount || d.amount <= 0)) {
        creditError = '盟友分配金額無效';
        return;
      }

      for (const d of normalized) {
        if (!findUserByAccount(store, d.account)) {
          creditError = `找不到盟友帳號：${d.account}`;
          return;
        }
      }

      const distSum = normalized.reduce((s, d) => s + d.amount, 0);
      if (distSum !== distributable) {
        creditError = `盟友分配總額 ${distSum} 需等於可分配餘額 ${distributable}（總額 ${totalAmount} − 公積金 ${guildFundAmount} − 秘書 ${secretaryAmount}${applyCrossSecretary ? ` − 跨服秘書 ${crossSecretaryAmount}` : ''}）`;
        return;
      }

      const ts = new Date().toISOString();
      const ref = `#${t.serial}`;

      normalized.forEach((d) => {
        const target = findUserByAccount(store, d.account);
        store.bankTransactions.unshift({
          id: 'b' + Date.now() + Math.random().toString(36).slice(2, 5),
          userId: target.id,
          type: '寶物收入',
          amount: d.amount,
          ref,
          treasureId: t.id,
          createdAt: ts
        });
      });

      store.guildSettings.fundBalance += guildFundAmount;
      store.guildSettings.secretaryBalance += secretaryAmount;
      store.guildSettings.crossSecretaryBalance += crossSecretaryAmount;

      store.treasures[idx] = {
        ...t,
        status: '已入帳',
        creditTotal: totalAmount,
        guildFundAmount,
        guildFundPercent: percent,
        secretaryAmount,
        secretaryPercent,
        applyCrossSecretary,
        crossSecretaryAmount,
        crossSecretaryPercent: applyCrossSecretary ? crossSecretaryPercent : 0,
        distributions: normalized,
        creditedAt: ts,
        creditedBy: user.account
      };
      updated = store.treasures[idx];
    });

    if (creditError) return sendJson(res, 400, { error: creditError });
    if (!updated) return sendJson(res, 400, { error: '無法入帳' });
    return sendJson(res, 200, updated);
  }

  if (pathname.match(/^\/api\/treasures\/[^/]+$/) && method === 'PATCH') {
    const user = requireAuth(req, res);
    if (!user) return;
    const id = pathname.split('/')[3];
    const body = await parseBody(req);
    let updated;
    let patchError = null;

    updateStore((store) => {
      const idx = store.treasures.findIndex((t) => t.id === id);
      if (idx < 0) {
        patchError = '找不到寶物';
        return;
      }
      const t = store.treasures[idx];
      if (t.status !== '待入帳') {
        patchError = '已入帳後不可修改';
        return;
      }

      const canManage = hasPermission(user, 'treasures.manage');
      const canEdit =
        canManage ||
        t.holder === user.account ||
        t.applicant === user.account ||
        t.leader === user.account;
      if (!canEdit) {
        patchError = '無權限修改此寶物';
        return;
      }

      const patch = {};
      if (body.participants !== undefined) {
        const participants = Array.isArray(body.participants)
          ? body.participants.map((s) => String(s).trim()).filter(Boolean)
          : String(body.participants)
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean);
        if (!participants.length) {
          patchError = '至少需要一位參與人員';
          return;
        }
        patch.participants = participants;
      }

      if (canManage) {
        ['boss', 'itemName', 'holder', 'leader', 'obtainedAt'].forEach((k) => {
          if (body[k] !== undefined) patch[k] = body[k];
        });
      }

      if (!Object.keys(patch).length) {
        patchError = '沒有可更新的欄位';
        return;
      }

      store.treasures[idx] = { ...t, ...patch };
      updated = store.treasures[idx];
    });

    if (patchError) return sendJson(res, 400, { error: patchError });
    return sendJson(res, 200, updated || {});
  }

  if (pathname.match(/^\/api\/treasures\/[^/]+$/) && method === 'DELETE') {
    const user = requireAuth(req, res);
    if (!user) return;
    const id = pathname.split('/')[3];
    let deleteError = null;
    updateStore((store) => {
      const t = store.treasures.find((x) => x.id === id);
      if (!t) {
        deleteError = '找不到寶物';
        return;
      }
      if (t.status === '待入帳') {
        if (!hasPermission(user, 'treasures.manage')) {
          deleteError = '僅管理員可刪除';
          return;
        }
      } else if (t.status === '已入帳') {
        if (user.role !== 'super_admin') {
          deleteError = '僅最高管理員可刪除已入帳寶物';
          return;
        }
        reverseTreasureCredit(store, t);
      } else {
        deleteError = '此狀態的寶物不可刪除';
        return;
      }
      store.treasures = store.treasures.filter((x) => x.id !== id);
    });
    if (deleteError) return sendJson(res, deleteError.includes('僅') ? 403 : 400, { error: deleteError });
    return sendJson(res, 200, { ok: true });
  }

  // Guild settings
  if (pathname === '/api/guild-settings' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    ensureGuildSettings(store);
    return sendJson(res, 200, store.guildSettings);
  }

  if (pathname === '/api/guild-settings' && method === 'PATCH') {
    const user = requirePerm(req, res, 'bank.manage');
    if (!user) return;
    const body = await parseBody(req);
    updateStore((store) => {
      ensureGuildSettings(store);
      const gs = store.guildSettings;
      const pctFields = ['fundPercent', 'secretaryPercent', 'crossSecretaryPercent'];
      pctFields.forEach((key) => {
        const pct = Number(body[key]);
        if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
          gs[key] = pct;
        }
      });
    });
    return sendJson(res, 200, readStore().guildSettings);
  }

  if (pathname === '/api/guild-settings/adjust' && method === 'POST') {
    const user = requirePerm(req, res, 'bank.manage');
    if (!user) return;
    const body = await parseBody(req);
    const amount = Number(body.amount);
    if (Number.isNaN(amount)) return sendJson(res, 400, { error: '金額無效' });

    const target = body.target || 'fund';
    const fundConfig = {
      fund: { balanceKey: 'fundBalance', historyKey: 'adjustHistory', label: '公積金' },
      secretary: { balanceKey: 'secretaryBalance', historyKey: 'secretaryAdjustHistory', label: '秘書抽成' },
      crossSecretary: {
        balanceKey: 'crossSecretaryBalance',
        historyKey: 'crossSecretaryAdjustHistory',
        label: '跨服秘書抽成'
      }
    };
    const cfg = fundConfig[target];
    if (!cfg) return sendJson(res, 400, { error: '無效的調整目標' });

    let result;
    let adjustError = null;
    updateStore((store) => {
      ensureGuildSettings(store);
      const gs = store.guildSettings;
      const before = gs[cfg.balanceKey];
      let after;
      let delta;

      if (body.mode === 'set') {
        if (amount < 0) {
          adjustError = '餘額不可為負數';
          return;
        }
        after = amount;
        delta = after - before;
      } else {
        after = before + amount;
        if (after < 0) {
          adjustError = '調整後餘額不可為負數';
          return;
        }
        delta = amount;
      }

      gs[cfg.balanceKey] = after;
      gs[cfg.historyKey].unshift({
        id: 'fa' + Date.now() + target,
        target,
        mode: body.mode || 'adjust',
        delta,
        balanceBefore: before,
        balanceAfter: after,
        note: body.note || '',
        by: user.account,
        createdAt: new Date().toISOString()
      });
      if (gs[cfg.historyKey].length > 100) gs[cfg.historyKey].length = 100;
      result = { ...gs };
    });

    if (adjustError) return sendJson(res, 400, { error: adjustError });
    return sendJson(res, 200, result);
  }

  // Bank
  if (pathname === '/api/bank/overview' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    ensureGuildSettings(store);
    const accounts = store.users
      .map((u) => ({
        account: u.account,
        clan: u.clan,
        characterClass: u.characterClass,
        systemTitle: u.systemTitle,
        role: u.role,
        balance: getUserBalance(store, u.id)
      }))
      .sort((a, b) => b.balance - a.balance || a.account.localeCompare(b.account, 'zh-Hant'));
    const memberTotal = accounts.reduce((s, a) => s + a.balance, 0);
    const depositTotal = store.depositAccounts.reduce((s, a) => s + a.balance, 0);
    const gs = store.guildSettings;
    const poolTotal = gs.fundBalance + gs.secretaryBalance + gs.crossSecretaryBalance;
    return sendJson(res, 200, {
      accounts,
      memberTotal,
      depositTotal,
      guildFundBalance: gs.fundBalance,
      secretaryBalance: gs.secretaryBalance,
      crossSecretaryBalance: gs.crossSecretaryBalance,
      poolTotal,
      grandTotal: memberTotal + poolTotal + depositTotal,
      count: accounts.length
    });
  }

  if (pathname === '/api/bank' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const txs = store.bankTransactions
      .filter((t) => t.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const balance = getUserBalance(store, user.id);
    const income = {};
    const expense = {};
    txs.forEach((t) => {
      if (t.amount >= 0) income[t.type] = (income[t.type] || 0) + t.amount;
      else expense[t.type] = (expense[t.type] || 0) + Math.abs(t.amount);
    });
    return sendJson(res, 200, { balance, availableBalance: getAvailableBalance(store, user.id), pendingWithdraws: (store.withdrawRequests || []).filter((r) => r.userId === user.id && r.status === '待審核'), transactions: txs, income, expense });
  }

  if (pathname === '/api/bank/withdraw' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await parseBody(req);
    const amount = Number(body.amount);
    if (!amount || amount <= 0) return sendJson(res, 400, { error: '金額無效' });
    const store = readStore();
    if (!store.withdrawRequests) store.withdrawRequests = [];
    const available = getAvailableBalance(store, user.id);
    if (available < amount) return sendJson(res, 400, { error: `可用餘額不足（含待審核 ${getPendingWithdrawTotal(store, user.id)}）` });
    const request = {
      id: 'wr' + Date.now(),
      userId: user.id,
      account: user.account,
      amount,
      note: body.note || '',
      status: '待審核',
      createdAt: new Date().toISOString()
    };
    updateStore((s) => {
      if (!s.withdrawRequests) s.withdrawRequests = [];
      s.withdrawRequests.unshift(request);
    });
    return sendJson(res, 201, request);
  }

  if (pathname === '/api/withdraw-requests' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const all = (store.withdrawRequests || []).map((r) => {
      const u = store.users.find((x) => x.id === r.userId);
      return { ...r, account: r.account || u?.account, characterClass: u?.characterClass };
    });
    const list = hasPermission(user, 'bank.manage')
      ? all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : all.filter((r) => r.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pendingCount = all.filter((r) => r.status === '待審核').length;
    return sendJson(res, 200, { requests: list, pendingCount });
  }

  if (pathname.match(/^\/api\/withdraw-requests\/[^/]+\/approve$/) && method === 'POST') {
    const user = requirePerm(req, res, 'bank.manage');
    if (!user) return;
    const id = pathname.split('/')[3];
    let result;
    let err = null;
    updateStore((store) => {
      if (!store.withdrawRequests) store.withdrawRequests = [];
      const idx = store.withdrawRequests.findIndex((r) => r.id === id);
      if (idx < 0) { err = '找不到申請'; return; }
      const req = store.withdrawRequests[idx];
      if (req.status !== '待審核') { err = '此申請已處理'; return; }
      const balance = getUserBalance(store, req.userId);
      if (balance < req.amount) { err = `${req.account} 餘額不足`; return; }
      const ts = new Date().toISOString();
      store.bankTransactions.unshift({
        id: 'b' + Date.now(),
        userId: req.userId,
        type: '提領',
        amount: -req.amount,
        ref: req.note || '提領核准',
        withdrawRequestId: req.id,
        createdAt: ts
      });
      store.withdrawRequests[idx] = {
        ...req,
        status: '已核准',
        reviewedAt: ts,
        reviewedBy: user.account
      };
      result = store.withdrawRequests[idx];
    });
    if (err) return sendJson(res, 400, { error: err });
    return sendJson(res, 200, result);
  }

  if (pathname.match(/^\/api\/withdraw-requests\/[^/]+\/reject$/) && method === 'POST') {
    const user = requirePerm(req, res, 'bank.manage');
    if (!user) return;
    const id = pathname.split('/')[3];
    const body = await parseBody(req);
    let result;
    let err = null;
    updateStore((store) => {
      const idx = (store.withdrawRequests || []).findIndex((r) => r.id === id);
      if (idx < 0) { err = '找不到申請'; return; }
      const req = store.withdrawRequests[idx];
      if (req.status !== '待審核') { err = '此申請已處理'; return; }
      store.withdrawRequests[idx] = {
        ...req,
        status: '已拒絕',
        rejectReason: body.reason || '',
        reviewedAt: new Date().toISOString(),
        reviewedBy: user.account
      };
      result = store.withdrawRequests[idx];
    });
    if (err) return sendJson(res, 400, { error: err });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/bank/transfer' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await parseBody(req);
    const amount = Number(body.amount);
    const target = readStore().users.find((u) => u.account === body.toAccount);
    if (!target) return sendJson(res, 404, { error: '找不到收款帳號' });
    if (!amount || amount <= 0) return sendJson(res, 400, { error: '金額無效' });
    const balance = getUserBalance(readStore(), user.id);
    if (balance < amount) return sendJson(res, 400, { error: '餘額不足' });
    const ts = new Date().toISOString();
    updateStore((s) => {
      s.bankTransactions.unshift(
        { id: 'b' + Date.now(), userId: user.id, type: '轉出', amount: -amount, ref: `轉至 ${body.toAccount}`, createdAt: ts },
        { id: 'b' + (Date.now() + 1), userId: target.id, type: '轉入', amount, ref: `來自 ${user.account}`, createdAt: ts }
      );
    });
    return sendJson(res, 201, { ok: true });
  }

  if (pathname === '/api/bank/adjust' && method === 'POST') {
    const user = requirePerm(req, res, 'bank.manage');
    if (!user) return;
    const body = await parseBody(req);
    const account = String(body.account || '').trim();
    const amount = Number(body.amount);
    if (!account) return sendJson(res, 400, { error: '請輸入帳號' });
    if (!amount) return sendJson(res, 400, { error: '金額無效' });
    const target = readStore().users.find((u) => u.account === account);
    if (!target) return sendJson(res, 404, { error: '找不到帳號' });
    const record = {
      id: 'b' + Date.now(),
      userId: target.id,
      type: body.type || '調整',
      amount,
      ref: body.note || '管理員調整',
      adjustedBy: user.account,
      createdAt: new Date().toISOString()
    };
    updateStore((s) => {
      s.bankTransactions.unshift(record);
    });
    return sendJson(res, 201, { ok: true, record: { ...record, account } });
  }

  if (pathname === '/api/bank/adjustments' && method === 'GET') {
    const user = requirePerm(req, res, 'bank.manage');
    if (!user) return;
    const store = readStore();
    const account = url.searchParams.get('account')?.trim();
    const type = url.searchParams.get('type')?.trim();
    const q = url.searchParams.get('q')?.trim().toLowerCase();

    let records = store.bankTransactions
      .filter((t) => t.adjustedBy)
      .map((t) => {
        const u = store.users.find((x) => x.id === t.userId);
        return {
          id: t.id,
          account: u?.account || '-',
          type: t.type,
          amount: t.amount,
          note: t.ref || '',
          adjustedBy: t.adjustedBy,
          createdAt: t.createdAt
        };
      });

    if (account) records = records.filter((r) => r.account === account);
    if (type) records = records.filter((r) => r.type === type);
    if (q) {
      records = records.filter(
        (r) =>
          r.account.toLowerCase().includes(q) ||
          r.note.toLowerCase().includes(q) ||
          r.adjustedBy.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q)
      );
    }

    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, { records: records.slice(0, 500) });
  }

  // Deposits
  if (pathname === '/api/deposits' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const total = store.depositAccounts.reduce((s, a) => s + a.balance, 0);
    return sendJson(res, 200, { accounts: store.depositAccounts, total });
  }

  if (pathname === '/api/deposits' && method === 'POST') {
    const user = requirePerm(req, res, 'deposits.manage');
    if (!user) return;
    const body = await parseBody(req);
    updateStore((s) => {
      const existing = s.depositAccounts.find((a) => a.account === body.account);
      if (existing) existing.balance += Number(body.amount);
      else s.depositAccounts.push({ id: 'd' + Date.now(), account: body.account, balance: Number(body.amount) });
    });
    return sendJson(res, 201, { ok: true });
  }

  // Deposit permissions
  if (pathname === '/api/deposit-permissions' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const list = store.depositPermissions.map((dp) => {
      const u = store.users.find((x) => x.id === dp.userId);
      return { id: dp.id, account: u?.account, class: u?.characterClass, clan: u?.clan };
    });
    return sendJson(res, 200, list);
  }

  if (pathname === '/api/deposit-permissions' && method === 'POST') {
    const user = requirePerm(req, res, 'deposits.manage');
    if (!user) return;
    const body = await parseBody(req);
    const target = readStore().users.find((u) => u.account === body.account);
    if (!target) return sendJson(res, 404, { error: '找不到成員' });
    updateStore((s) => {
      if (!s.depositPermissions.find((p) => p.userId === target.id)) {
        s.depositPermissions.push({ id: 'dp' + Date.now(), userId: target.id });
      }
    });
    return sendJson(res, 201, { ok: true });
  }

  // Users (admin)
  if (pathname === '/api/users/accounts' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const accounts = readStore()
      .users.map((u) => u.account)
      .filter((a) => !q || a.toLowerCase().includes(q))
      .slice(0, 30);
    return sendJson(res, 200, accounts);
  }

  if (pathname === '/api/users' && method === 'GET') {
    const user = requirePerm(req, res, 'users.view');
    if (!user) return;
    return sendJson(res, 200, readStore().users.map(sanitizeUser));
  }

  if (pathname === '/api/users' && method === 'POST') {
    const user = requirePerm(req, res, 'users.manage');
    if (!user) return;
    const body = await parseBody(req);
    const role = body.role || 'member';
    if (role === 'super_admin' && user.role !== 'super_admin') {
      return sendJson(res, 403, { error: '僅最高管理員可設定最高管理員權限' });
    }
    const store = readStore();
    const account = String(body.account || '').trim();
    if (!account) return sendJson(res, 400, { error: '請輸入帳號' });
    if (store.users.some((u) => u.account === account)) {
      return sendJson(res, 400, { error: '帳號已存在' });
    }
    const newUser = {
      id: 'u' + Date.now(),
      account,
      clan: body.clan || '女妖',
      groupId: 'g1',
      characterClass: body.characterClass || '王族',
      role,
      systemTitle: body.systemTitle || ROLE_LABELS[role] || '會員',
      password: hashPassword(body.password || '1234'),
      createdAt: new Date().toISOString()
    };
    updateStore((s) => s.users.push(newUser));
    return sendJson(res, 201, sanitizeUser(newUser));
  }

  if (pathname.match(/^\/api\/users\/[^/]+\/reset-password$/) && method === 'POST') {
    const user = requirePerm(req, res, 'users.manage');
    if (!user) return;
    const id = pathname.split('/')[3];
    let updated;
    let err = null;
    updateStore((store) => {
      const idx = store.users.findIndex((u) => u.id === id);
      if (idx < 0) {
        err = '找不到成員';
        return;
      }
      const target = store.users[idx];
      if (target.role === 'super_admin' && user.role !== 'super_admin') {
        err = '無法重置最高管理員密碼';
        return;
      }
      target.password = hashPassword('1234');
      Object.keys(store.sessions).forEach((token) => {
        if (store.sessions[token].userId === id) delete store.sessions[token];
      });
      updated = sanitizeUser(target);
    });
    if (err) return sendJson(res, 400, { error: err });
    return sendJson(res, 200, { ok: true, user: updated, message: '密碼已重置為 1234' });
  }

  if (pathname.match(/^\/api\/users\/[^/]+$/) && method === 'PATCH') {
    const user = requirePerm(req, res, 'users.manage');
    if (!user) return;
    const id = pathname.split('/').pop();
    const body = await parseBody(req);
    const role = body.role;
    if (role === 'super_admin' && user.role !== 'super_admin') {
      return sendJson(res, 403, { error: '僅最高管理員可設定最高管理員權限' });
    }
    let updated;
    let err = null;
    updateStore((store) => {
      const idx = store.users.findIndex((u) => u.id === id);
      if (idx < 0) {
        err = '找不到成員';
        return;
      }
      const target = store.users[idx];
      if (target.role === 'super_admin' && user.role !== 'super_admin') {
        err = '無法修改最高管理員';
        return;
      }
      if (body.account !== undefined) {
        const newAccount = String(body.account).trim();
        if (!newAccount) {
          err = '帳號不可為空';
          return;
        }
        if (newAccount !== target.account) {
          if (store.users.some((u) => u.account === newAccount && u.id !== id)) {
            err = '帳號已存在';
            return;
          }
          const oldAccount = target.account;
          target.account = newAccount;
          renameAccountReferences(store, oldAccount, newAccount);
        }
      }
      ['clan', 'characterClass', 'systemTitle'].forEach((k) => {
        if (body[k] !== undefined) target[k] = body[k];
      });
      if (role) {
        target.role = role;
        if (!body.systemTitle) target.systemTitle = ROLE_LABELS[role] || target.systemTitle;
      }
      if (body.password && body.password.length >= 4) {
        target.password = hashPassword(body.password);
      }
      updated = sanitizeUser(target);
    });
    if (err) return sendJson(res, 400, { error: err });
    return sendJson(res, 200, updated);
  }

  if (pathname.match(/^\/api\/users\/[^/]+$/) && method === 'DELETE') {
    const user = requirePerm(req, res, 'users.manage');
    if (!user) return;
    const id = pathname.split('/').pop();
    if (id === user.id) return sendJson(res, 400, { error: '無法刪除自己的帳號' });
    let err = null;
    updateStore((store) => {
      const target = store.users.find((u) => u.id === id);
      if (!target) {
        err = '找不到成員';
        return;
      }
      if (target.role === 'super_admin') {
        err = '無法刪除最高管理員帳號';
        return;
      }
      store.users = store.users.filter((u) => u.id !== id);
      store.depositPermissions = store.depositPermissions.filter((p) => p.userId !== id);
      store.favoriteLists = store.favoriteLists.filter((f) => f.userId !== id);
      Object.keys(store.sessions).forEach((token) => {
        if (store.sessions[token].userId === id) delete store.sessions[token];
      });
    });
    if (err) return sendJson(res, 400, { error: err });
    return sendJson(res, 200, { ok: true });
  }

  // Settings
  if (pathname === '/api/settings' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const lists = store.favoriteLists.filter((f) => f.userId === user.id);
    return sendJson(res, 200, { user: sanitizeUser(user), favoriteLists: lists });
  }

  if (pathname === '/api/settings/password' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await parseBody(req);
    if ((body.password || '').length < 4) return sendJson(res, 400, { error: '密碼至少 4 字' });
    updateStore((s) => {
      const idx = s.users.findIndex((u) => u.id === user.id);
      if (idx >= 0) s.users[idx].password = hashPassword(body.password);
    });
    destroySession(getTokenFromRequest(req));
    return sendJson(res, 200, { ok: true, message: '密碼已更新，請重新登入' });
  }

  if (pathname === '/api/settings/profile' && method === 'PATCH') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await parseBody(req);
    updateStore((s) => {
      const idx = s.users.findIndex((u) => u.id === user.id);
      if (idx >= 0) {
        ['account', 'characterClass', 'clan', 'systemTitle'].forEach((k) => {
          if (body[k]) s.users[idx][k] = body[k];
        });
      }
    });
    return sendJson(res, 200, { ok: true });
  }

  // Todos
  if (pathname === '/api/todos' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const store = readStore();
    const pending = store.treasures.filter(
      (t) => t.holder === user.account && (t.status === '待入帳' || t.status === '待交易')
    );
    return sendJson(res, 200, { pendingCredit: pending, count: pending.length });
  }

  // Data backup / restore (super_admin only)
  if (pathname === '/api/admin/backup' && method === 'GET') {
    const user = requireSuperAdmin(req, res);
    if (!user) return;
    const store = readStore();
    return sendJson(res, 200, {
      exportedAt: new Date().toISOString(),
      exportedBy: user.account,
      store
    });
  }

  if (pathname === '/api/admin/restore' && method === 'POST') {
    const user = requireSuperAdmin(req, res);
    if (!user) return;
    const body = await parseBody(req);
    const merged = mergeStoreData(body.store || body);
    if (!merged) return sendJson(res, 400, { error: '備份格式無效' });
    writeStore(merged);
    return sendJson(res, 200, {
      ok: true,
      message: '資料已還原',
      restoredAt: new Date().toISOString(),
      restoredBy: user.account
    });
  }

  if (pathname === '/api/admin/clear-data' && method === 'POST') {
    const user = requireSuperAdmin(req, res);
    if (!user) return;
    const body = await parseBody(req);
    if (body.confirm !== 'CLEAR_ALL_DATA') {
      return sendJson(res, 400, { error: '確認碼不正確' });
    }
    const store = readStore();
    const usersKept = store.users.length;
    writeStore(buildClearedStore(store));
    return sendJson(res, 200, {
      ok: true,
      message: '已清零營運資料，成員帳號已保留',
      clearedAt: new Date().toISOString(),
      clearedBy: user.account,
      usersKept
    });
  }

  sendJson(res, 404, { error: 'API not found' });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (req.url.startsWith('/api/')) return await handleApi(req, res);
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: '伺服器錯誤' });
  }
});

// 啟動時載入資料（重新部署後從 store.production.json 自動還原）
const dataFile = path.join(__dirname, 'data', 'store.json');
if (!fs.existsSync(PUBLIC)) {
  console.error('❌ 找不到 public 目錄：', PUBLIC);
  process.exit(1);
}
if (!fs.existsSync(path.join(PUBLIC, 'login.html'))) {
  console.error('❌ 找不到 login.html，請確認 public 資料夾已上傳');
  process.exit(1);
}
if (!fs.existsSync(dataFile)) {
  if (fs.existsSync(PRODUCTION_FILE)) {
    const dataDir = path.dirname(dataFile);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(PRODUCTION_FILE, dataFile);
    console.log('✅ 已從 store.production.json 還原資料（部署自動載入）');
  } else {
    await import('./seed.js');
    console.log('ℹ️  無資料快照，已建立預設初始資料');
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`\n🎮 天堂M管理系統已啟動`);
  console.log(`   網址：${publicUrl}`);
  console.log(`   最高權限帳號：極致 / 密碼=love0227\n`);
});
