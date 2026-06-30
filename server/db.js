import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const PRODUCTION_FILE = path.join(DATA_DIR, 'store.production.json');

const DEFAULT_STORE = {
  groups: [],
  users: [],
  announcements: [],
  events: [],
  treasures: [],
  bankTransactions: [],
  withdrawRequests: [],
  dkpRecords: [],
  dkpSettings: { defaultPoints: 0 },
  guildSettings: {
    fundPercent: 10,
    fundBalance: 0,
    adjustHistory: [],
    secretaryPercent: 0,
    secretaryBalance: 0,
    secretaryAdjustHistory: [],
    crossSecretaryPercent: 0,
    crossSecretaryBalance: 0,
    crossSecretaryAdjustHistory: []
  },
  depositAccounts: [],
  depositPermissions: [],
  notifications: [],
  favoriteLists: [],
  sessions: {}
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
  }
}

export function readStore() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

export function writeStore(store) {
  ensureDataFile();
  const content = JSON.stringify(store, null, 2);
  fs.writeFileSync(DATA_FILE, content, 'utf8');
  try {
    fs.writeFileSync(PRODUCTION_FILE, content, 'utf8');
  } catch {
    /* 唯讀檔案系統時略過 */
  }
}

export function updateStore(mutator) {
  const store = readStore();
  mutator(store);
  writeStore(store);
  return store;
}

export function nextId(prefix, store, field = 'id') {
  const items = store[prefix] || [];
  const nums = items
    .map((item) => String(item[field] || ''))
    .filter((id) => id.startsWith(prefix === 'events' ? '' : ''));
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}

export function generateSerial(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const store = readStore();
  const prefix = `${y}${m}${d}`;
  const count =
    store.treasures.filter((x) => String(x.serial || '').startsWith(prefix)).length + 1;
  return `${prefix}${String(count).padStart(3, '0')}`;
}

export { DATA_FILE, PRODUCTION_FILE, DEFAULT_STORE };
