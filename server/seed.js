import { readStore, writeStore } from './db.js';
import { hashPassword } from './auth.js';

const existing = readStore();
const store = {
  groups: [{ id: 'g1', name: '群組1', server: '極致' }],
  users: existing.users?.length
    ? existing.users
    : [
        {
          id: 'u-admin',
          account: '極致',
          clan: '女妖',
          groupId: 'g1',
          characterClass: '王族',
          role: 'super_admin',
          systemTitle: '會長',
          password: hashPassword('love0227'),
          createdAt: new Date().toISOString()
        }
      ],
  announcements: existing.announcements?.length
    ? existing.announcements
    : [
        {
          id: 'a1',
          content:
            '【公告】領鑽石請至個人銀行申請提領，無須上傳圖片。盟員寶物回購 8 折、一般 7 折。交易請使用鎖定鑽石，注意安全。',
          createdAt: new Date().toISOString(),
          active: true
        }
      ],
  events: [],
  treasures: [],
  bankTransactions: [],
  withdrawRequests: [],
  dkpRecords: [],
  dkpSettings: { defaultPoints: 0, eventPoints: 10 },
  guildSettings: { fundPercent: 10, fundBalance: 0, adjustHistory: [] },
  depositAccounts: [],
  depositPermissions: existing.depositPermissions?.length
    ? existing.depositPermissions
    : [{ id: 'dp1', userId: 'u-admin' }],
  notifications: [],
  favoriteLists: existing.favoriteLists?.length
    ? existing.favoriteLists
    : [
        { id: 'f1', userId: 'u-admin', name: '常用名單 1', members: ['極致'] },
        { id: 'f2', userId: 'u-admin', name: '常用名單 2', members: ['極致'] },
        { id: 'f3', userId: 'u-admin', name: '常用名單 3', members: [] }
      ],
  sessions: existing.sessions || {}
};

writeStore(store);
console.log('✅ 歷史紀錄已清除，帳號資料已保留');
console.log('最高權限帳號：極致 / 密碼=love0227');
