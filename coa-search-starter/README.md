# CoA Search — manifest 自動更新（GitHub Actions）

這是一個可直接丟到 GitHub 的起始專案。
- 前端：`docs/index.html` + `docs/app.js`
- PDF 放這裡：`docs/files/`（可含子資料夾）
- 清單輸出：`docs/manifest/`（自動產生）
- 自動化：`.github/workflows/build-manifest.yml`（每日更新）

## 本機測試
1. 安裝 Node.js 20+
2. 在專案根目錄執行：
   ```bash
   node scripts/build-manifest.mjs
   ```
3. 用任何靜態伺服器開 `docs/`（或直接用 VSCode Live Server）。

## 命名規則
- 舊制：`107060-250603.pdf`
- 新制（管）：`MB-P08B-Lot-107077.pdf`
- 新制（蓋）：`MB-P08BCAP-Lot-250607.pdf`
（大小寫/底線/空白容錯在搜尋端處理，但**檔名本體**建議照上列形式。）

## GitHub Pages
建議用 **Branch: main / docs folder**。
