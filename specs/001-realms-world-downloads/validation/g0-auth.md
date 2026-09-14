# G0 真實授權紀錄

**日期**：2026-09-14（Asia/Taipei）

**狀態**：T025 未完成。以下只記真實觀察，不把網站登入或 Microsoft 登入成功當作完整 Realms 連接成功。

使用者已親自初始化管理員、登入網站，並完成 Microsoft 官方裝置碼階段。私人 Sites 版本 1 的管理頁顯示已登入；連線進入 exchanging_tokens，後續多次獨立 HTTP 請求持續 pending。加密狀態保留於 D1，未把代碼、token、私人 ID 或上游回應加入紀錄。

2026-09-13 17:37:42 UTC 的成功網站登入：Worker CPU 294 ms、wall time 918 ms、outcome=ok，request ID `726d5bbd50a9745afc29ea6d9adbe6cb`。之後 connection-start 及跨請求 step 能持續讀寫加密狀態。

## 本次修正與待核對結果

複查 [固定版 Xbox 轉接器參考](https://github.com/PrismarineJS/prismarine-auth/blob/b795199dc5fa26059655bb1bc91c7f7f2733b232/src/TokenManagers/XboxTokenManager.js)，移除本實作額外加入、沒有實測依據的 OptionalDisplayClaims=[xid]，沿用預設 claims。擁有者 XUID 仍必須存在且格式有效，沒有放寬歸屬檢查。這是協定差異修正，尚不能確定它就是本次 pending 的根因。

永久 HTTP 4xx 相容性錯誤改為結束此次授權；429／5xx 保持可重試，缺少穩定擁有者欄位明確拒絕，避免將永久錯誤偽裝成暫時失敗並持續重試。新增安全診斷只記固定交換階段及 HTTP 狀態碼；不記 token、URL、回應內容、帳號或識別值。頁面補上未完成／到期提示。

新增 3 項回歸案例，連同既有測試共 50 項通過；型別、ESLint 與生產建置通過。修正後的真實 Xbox／Realms 連接結果待部署確認，未標成通過。

### 第二次真實觀察與身分步驟

Sites 版本 2（Git `2b2c59218cb52e98ffbcc6a7b7b9deaa9e2839d9`）部署後，2026-09-13 17:45:31 UTC 安全診斷確認 xsts 回 HTTP 200，但沒有穩定擁有者 claim，原因為 missing_owner_claim。工作改為 denied 並清除加密授權狀態，沒有將連線標成成功。這份證據確認卡住原因；先前移除 OptionalDisplayClaims 的變更不足以解決問題。

依同一固定參考的 [Xbox relying party](https://github.com/PrismarineJS/prismarine-auth/blob/b795199dc5fa26059655bb1bc91c7f7f2733b232/src/common/Constants.js)，新增獨立的 Xbox 身分交換，再核對同帳號的 Realms 專用權杖。沒有切換 application、scope 或以 Xbox 通用權杖呼叫 Realms。已同步研究與轉接器契約。

兩個新增案例先失敗，再完成實作後通過：分段取得身分與 Realms 權杖、兩者 user hash 不一致時拒絕。此時共 52 項測試；真實新授權仍待修正版部署及使用者再次連接。

### 重新載入後接續授權

Sites 版本 3 於 2026-09-13 17:51:22 UTC 部署成功。後續觀察到 connection 為 authorizing，現存工作仍在 waiting_for_user，最後輪詢時間停在 17:49:40 UTC；沒有證據顯示新身分步驟已完成。使用者回報畫面顯示「授權進行中」，不能據此判定 Microsoft 已完成授權。

程式檢查確認重新載入頁面只恢復連線狀態，未恢復 React 記憶體中的授權工作，造成代碼與輪詢遺失。新增同 session 讀回安全投影並接續既有 step；其他 session 無法取得 challenge，到期代碼隱藏，解除後不會復活。新增回歸先失敗、實作後通過；目前共 53 項測試，型別、ESLint 與建置通過。此項本機驗證不代表真實 Microsoft／Xbox／Realms 成功連接。

## 2026-09-14 真實成功連線與新網站登入

Sites 版本 4 的 D1 連線紀錄顯示 2026-09-13 18:17:17.130 UTC 成功進入 connected，token_version=1 且存在加密連線封裝；未記錄私人帳號識別或權杖。後續 Chrome 重新登入網站後仍顯示「已連接」，使用者亦回覆「已登入」，不需再次 Microsoft 授權。這證明首次完整身分／Realms 權杖交換及跨網站登入重用；尚未證明真實續期與完整 T025。

同次回報「登入不了」已重現為首頁 next/link 點擊時的 vinext 用戶端例外，並非密碼判定失敗。直接開啟管理員頁及使用者登入均成功，入口與回首頁改用原生導航，首頁按鈕文字改為「管理員登入」。另發現世界讀取前因 REALMS_CLIENT_VERSION 空值而拒絕；版本與列表實測見 [G0 歸屬紀錄](g0-association.md)。

Sites 版本 5 部署後，已在使用者原 Chrome 分頁實際點擊「回首頁 → 管理員登入」，網址與畫面均正確跳轉，既有網站登入及 Microsoft 連線保持有效。TypeScript、ESLint 與五階段生產建置通過；此次只更改原生連結與部署版本設定，未新增會重複實作的單元測試。既有 53 項核心測試結果屬前次已完成驗證，沒有宣稱本次重跑。

## 剩餘驗收

明確冷啟動、取消／拒絕／降速／到期、解除晚到結果仍須逐項記錄。真實續期成功路徑見下節，不能視為其他情境已通過。未完成 T025～T030 前不得開始完整產品故事。

## 2026-09-14 真實續期成功與讀取世界接續修正

使用者再次回報已連接但無法讀取世界。Sites 版本 8 的紀錄在 15:24:08～15:24:24 UTC 出現四次 GET /api/admin/verification/worlds 的 503；同世代 generation=11 的 token_version 已由首次連接的 1 推進至 5，沒有解除連線。程式確認 getValidRealmsAuthorization 每個請求只完成一個續期階段，pending 被 refreshWorlds 轉成一般 unavailable，而頁面只發一次請求，使用者因此必須反覆點擊。

在原本已登入的管理頁接續讀取，15:26:34.886 UTC 的 token_version=6，15:27:12.333 UTC 為 7 且 status=connected。後一次請求完整取得 6 個欄位，指定欄位 3 仍發布 latest。此路徑未要求再次 Microsoft 授權，也未更換連線世代；依固定六階段流程，完成 refresh token、Xbox token 與 Realms XSTS 重建並通過真正 Realms 列表請求。last_verified_at 目前只記首次連接，不能拿該舊欄位當作本次續期時間。

修正將等待續期區分為 authorization_refreshing（503，附 Retry-After）。管理頁讀取世界時顯示進度，只接續此明確訊號，最多 12 次、120 秒；遵守等待間隔，離頁取消。一般上游失敗、登入失效及其他 503 不自動重送，發布及下載工作也不由此流程重建。新增 6 項回歸，合計 65 項測試通過，涵蓋分段結果、間隔、取消、上限、一般錯誤停止及保留已發布欄位。部署後瀏覽器結果另記。
