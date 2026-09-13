# G0 真實授權紀錄

**日期**：2026-09-14（Asia/Taipei）

**狀態**：T025 未完成。以下只記真實觀察，不把網站登入或 Microsoft 登入成功當作完整 Realms 連接成功。

使用者已親自初始化管理員、登入網站，並完成 Microsoft 官方裝置碼階段。私人 Sites 版本 1 的管理頁顯示已登入；連線進入 exchanging_tokens，後續多次獨立 HTTP 請求持續 pending。加密狀態保留於 D1，未把代碼、token、私人 ID 或上游回應加入紀錄。

2026-09-13 17:37:42 UTC 的成功網站登入：Worker CPU 294 ms、wall time 918 ms、outcome=ok，request ID `726d5bbd50a9745afc29ea6d9adbe6cb`。之後 connection-start 及跨請求 step 能持續讀寫加密狀態。

## 本次修正與待核對結果

複查 [固定版 Xbox 轉接器參考](https://github.com/PrismarineJS/prismarine-auth/blob/b795199dc5fa26059655bb1bc91c7f7f2733b232/src/TokenManagers/XboxTokenManager.js)，移除本實作額外加入、沒有實測依據的 OptionalDisplayClaims=[xid]，沿用預設 claims。擁有者 XUID 仍必須存在且格式有效，沒有放寬歸屬檢查。這是協定差異修正，尚不能確定它就是本次 pending 的根因。

永久 HTTP 4xx 相容性錯誤改為結束此次授權；429／5xx 保持可重試，缺少穩定擁有者欄位明確拒絕，避免將永久錯誤偽裝成暫時失敗並持續重試。新增安全診斷只記固定交換階段及 HTTP 狀態碼；不記 token、URL、回應內容、帳號或識別值。頁面補上未完成／到期提示。

新增 3 項回歸案例，連同既有測試共 50 項通過；型別、ESLint 與生產建置通過。修正後的真實 Xbox／Realms 連接結果待部署確認，未標成通過。

## 剩餘驗收

成功連接、冷啟動／新網站登入重用、一次真實 refresh token 續期與 XSTS 重建、取消／拒絕／降速／到期、解除晚到結果，仍須逐項記錄。人工測試不能取代真實成功路徑。未完成 T025～T030 前不得開始完整產品故事。
