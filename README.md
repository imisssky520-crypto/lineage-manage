# 天堂M 血盟管理系統

仿 LineageManage 的血盟管理網站，**已移除拍賣 / 跨服拍賣功能**，**不需要上傳圖片**。

## 功能

- 首頁（公告、待辦）
- 寶物申報（純文字，無圖片上傳）
- 個人銀行（餘額、圖表、提領、轉帳）
- 公積金設定（抽成比例、餘額調整）
- 儲值系統 / 儲值權限
- 待辦清單
- 個人設定
- 管理員：成員管理、公告管理、銀行調整

## 快速啟動（本機）

需要 Node.js 18+

```bash
cd C:\Users\WEI\Projects\lineage-manage
node server/index.js
```

瀏覽器開啟：http://localhost:3000/login.html

### 最高權限帳號

| 欄位 | 值 |
|------|-----|
| 帳號 | 極致 |
| 密碼 | love0227 |
| 權限 | super_admin（最高） |

## 免費部署（Render · 方案二）

### 一、推送到 GitHub

在專案目錄執行（需已安裝 [Git](https://git-scm.com/download/win) 與 [GitHub CLI](https://cli.github.com/)）：

```powershell
cd C:\Users\WEI\Projects\lineage-manage
gh auth login
.\deploy-to-render.ps1
```

或手動：

```powershell
git init
git add .
git commit -m "Prepare Render deployment"
gh repo create lineage-manage --private --source=. --remote=origin --push
```

### 二、在 Render 建立服務

1. 到 [Render Dashboard](https://dashboard.render.com/) 註冊（可用 GitHub 登入）
2. 點 **New +** → **Blueprint**
3. 連接 GitHub 帳號，選擇 `lineage-manage` 倉庫
4. Render 會自動讀取 `render.yaml`，確認後點 **Apply**
5. 等待部署完成（約 2～5 分鐘）

### 三、取得網址

部署成功後會顯示公開網址，例如：

```
https://lineage-manage-xxxx.onrender.com/login.html
```

把此網址傳給血盟成員即可登入。

### 預設管理員（首次部署）

| 帳號 | 極致 |
| 密碼 | love0227 |

**上線後請立刻修改密碼。**

### 注意事項

| 項目 | 說明 |
|------|------|
| 免費版休眠 | 15 分鐘無人使用會休眠，下次開啟需等約 30～60 秒 |
| 資料儲存 | 資料在 `server/data/store.json`；重新部署可能重置，請定期備份 |
| 本機資料 | 雲端為全新環境，需重新新增成員（或自行備份還原 store.json） |
| 更新網站 | 修改程式後 `git push`，Render 會自動重新部署 |

### 手動設定（不用 Blueprint）

若不用 `render.yaml`，建立 **Web Service** 時設定：

- **Build Command**：留空
- **Start Command**：`npm start`
- **Health Check Path**：`/login.html`

## 資料儲存

資料保存在 `server/data/store.json`。重新初始化：

```bash
node server/seed.js
```

## 技術

- 後端：Node.js 內建 HTTP（零依賴）
- 前端：原生 HTML/CSS/JS + Chart.js CDN
- 資料：JSON 檔案
