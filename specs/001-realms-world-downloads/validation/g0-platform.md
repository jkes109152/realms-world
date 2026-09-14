# G0 平台實測紀錄

**日期**：2026-09-14（Asia/Taipei）

**狀態**：T024 部分完成，不能勾選。部署、D1 綁定、初始化條件 batch、維護停用及一次固定成本 scrypt 執行已有真實結果；成功登入、記憶體與配額核對仍待完成。

## 執行版本

- Git：`07791e7e8d1e95d1673575b03ec7473a299ac572`。
- Site：`appgprj_6aa6c974d20c819190c80769f229f138`。
- Sites 版本：1，`appgprj_6aa6c974d20c819190c80769f229f138~appgver_ac956527d3c88191b92e7188a4acb1c5`。
- 部署：`appgdep_6aa6dcc5bef08191a409673216758c18`，2026-09-13 17:26:45 UTC 確認 succeeded，套用環境設定 revision 1。
- 私人入口：[Realms World](https://realms-world-jkesbyebye.jkes109152.chatgpt.site)。仍只有擁有者可存取，沒有外部訪客或群組；`DOWNLOADS_ENABLED=false`。
- 部署檔含 Worker 及 D1 遷移，不含 `.dev.vars`、世界檔或本機工具。使用既有 Git Bash 與 POSIX archive 路徑處理 Windows 包裝器相容性，沒有啟用 WSL 或修改全域環境。

## 已通過的真實檢查

| 項目 | 結果 |
|---|---|
| D1 binding | DB，13 張應用資料表已建立，名稱與 schema 相符 |
| 正確維護秘密查詢版本 | HTTP 200，initialized=false、credentialVersion=null（初始化前） |
| 缺維護秘密 | HTTP 404、not_available |
| 未登入 session | HTTP 401、session_expired |
| 公開世界列表 | HTTP 503、temporarily_unavailable |
| 公開建立下載 | HTTP 503、temporarily_unavailable |
| 人工不存在帳號登入 | HTTP 401、login_failed；相同固定成本 scrypt 仍有執行 |

以上 HTTP 檢查使用既有私人 Sites 存取權，沒有改為公開、建立新的 bypass token 或呼叫 Microsoft／Realms。維護秘密只置於程序環境及 Sites 秘密設定，未寫入本文件或 Git。

人工錯誤登入的來源端總耗時為 2,901 ms；Sites Worker 紀錄同一次請求 CPU 為 254 ms、wall time 為 642 ms、outcome=ok，request ID 為 `c1b44c07930ae35afaf0f3081dd1b7b0`。HTTP 往返時間包含網路與外層轉送，不能當作 scrypt CPU。未取得每請求記憶體或配額設定，因此不宣稱該部分通過。

## 管理員初始化進度

已提供互動、不回顯密碼的 CLI。第一次使用者操作因密碼長度不符而在送出前停止；沒有建立帳號或消耗維護秘密。重新開啟操作視窗後，使用者完成初始化。每次重試先查帳號版本，再由操作者輸入 CONFIRM，沒有自動重送維護寫入。

已於私人維護入口核實 initialized=true、credentialVersion=1，證明初始化條件 batch 成功；隨即移除 `MAINTENANCE_TOKEN`，Sites 設定成為 revision 2，使用同一程式版本重新部署。成功登入與後續條件寫入仍待驗證。

### 秘密移除的實測差異與處理

revision 2 部署回報成功、設定清單已無 MAINTENANCE_TOKEN，但舊值查詢維護版本仍回 200。不能只依設定清單宣稱秘密已失效。將該秘密明確設為空字串並部署 revision 3 後，使用舊值查詢回 404；再移除該鍵並部署 revision 4，舊值仍回 404。未改動程式或降低密碼成本。

目前執行部署為 `appgdep_6aa6df374cec8191a7869c9dc6650387`，同一 Sites 版本 1，環境 revision 4，於 2026-09-13 17:37:44 UTC 確認 succeeded。最後維護拒絕檢查使用不同查詢識別值，回應 no-store，沒有把可能的舊快取當作新部署證據。

後續維護流程須實際測試舊秘密拒絕；若直接移除未生效，先以空值部署使入口拒絕，再刪除設定並重新部署核實。不能假設平台移除鍵必然立即清除既有 Worker 秘密。

## 尚待完成的 G0 項目

T025 真實 Microsoft 授權／續期、T026 欄位與全部歷史歸屬、T027 真實下載／遊戲匯入、T028 hosted 大型串流、T029 hosted 競爭與不明結果，以及 T030 彙整均未完成。目前沒有發布驗收世界。
