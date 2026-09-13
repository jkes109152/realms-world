# 專案準備驗證

**日期**：2026-09-14

T002～T005 已完成。既有 Git、`.agents/`、`.specify/` 與 SDD 保留；單一 Sites 已註冊並保持私人、尚未部署。D1 binding 為 DB，沒有 R2。

- Node 24.19.0；npm 12.0.2 官方套件經 SHA-512 完整性驗證，本機執行器放於忽略的 `.tools/`。Windows 的 Sites npm 啟動器以程序內路徑設定修正，不修改全域環境。
- Sites starter 鎖定依賴保留；新增 Vitest 4.1.11、@cloudflare/vitest-plugin 1.1.8、Playwright 1.63.0。npm 12 的原生安裝腳本允許清單只涵蓋已鎖定的 esbuild、workerd 與 unrs-resolver。
- `tsc --noEmit`：通過。
- `vitest run`：2 個檔案、6 項測試通過，包含 Worker 內真正本機 D1 的預備寫入／RETURNING。
- Sites `build-site.mjs`：五階段建置通過。當時頁面仍為 starter，尚未作產品畫面或瀏覽器驗收。
- 測試預設拒絕外部 fetch；人工 Realm／兩欄位／歷史與串流只在測試使用。
- DOWNLOADS_ENABLED 預設 false；缺少版本與精確下載主機時拒絕相關能力。

本紀錄只證明本機準備完成，不代表 G0 真實授權、遠端 D1、下載或遊戲匯入通過。
