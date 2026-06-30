import { readStore, writeStore } from './db.js';

const store = readStore();
store.events = [];
store.treasures = [];
store.bankTransactions = [];
store.dkpRecords = [];
store.depositAccounts = [];
writeStore(store);
console.log('✅ 已清除寶物、銀行、DKP、儲值歷史紀錄');
