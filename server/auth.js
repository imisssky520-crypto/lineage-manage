import crypto from 'crypto';
import { readStore, writeStore } from './db.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const store = readStore();
  store.sessions[token] = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  writeStore(store);
  return token;
}

export function destroySession(token) {
  if (!token) return;
  const store = readStore();
  delete store.sessions[token];
  writeStore(store);
}

export function getSessionUser(token) {
  if (!token) return null;
  const store = readStore();
  const session = store.sessions[token];
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    delete store.sessions[token];
    writeStore(store);
    return null;
  }
  return store.users.find((u) => u.id === session.userId) || null;
}

export function getTokenFromRequest(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export const ROLE_LABELS = {
  super_admin: '最高管理員',
  admin: '管理員',
  deposit_admin: '儲值管理',
  member: '一般會員'
};

export const PERMISSIONS = {
  super_admin: ['*'],
  admin: [
    'treasures.manage',
    'bank.manage',
    'deposits.manage',
    'announcements.manage',
    'users.view',
    'users.manage'
  ],
  deposit_admin: ['deposits.manage', 'bank.view', 'treasures.view'],
  member: ['treasures.view', 'bank.view']
};

export function hasPermission(user, permission) {
  if (!user) return false;
  const perms = PERMISSIONS[user.role] || PERMISSIONS.member;
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}
