# 網站 HTTP 介面契約

**日期**：2026-09-13

**依據**：[計畫](../plan.md)、[資料模型](../data-model.md)

**狀態**：待實作；下列路由尚不存在。

## 共通格式與保護

所有 API 同源，以 `/api` 開頭；正式 origin 為 `https://realms.jkesbyebye.com`。本機／預覽 origin 由後端精確設定，不能接受任意 Host 或寬鬆字尾比對。關閉跨源 CORS；JSON 寫入要求 `Content-Type: application/json`、精確 Origin 及最多 16 KiB 請求體。附件兌換另採表單，最多 4 KiB。

維護 CLI 端點使用獨立部署秘密，不依賴瀏覽器 Origin／Cookie；其規則由[維護契約](maintenance.md)單獨定義。

成功回應為 `{"data": ...}`；錯誤為：

```json
{
  "error": {
    "code": "temporarily_unavailable",
    "message": "目前暫時無法下載，請稍後再試。",
    "retryAfterSeconds": 30,
    "requestId": "不可識別帳號的追蹤值"
  }
}
```

retryAfterSeconds 無適用值時為 null；可重試回應同時給 Retry-After。所有動態、管理、狀態、票據及附件回應均 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`；敏感流程使用 `Referrer-Policy: no-referrer`。不記錄請求秘密、密碼或原始上游回應。ID 做長度／格式檢查，拒絕未知欄位，禁止訪客提交 URL。

一般管理路由每次驗證資料庫 session、閒置／絕對期限及 credential_version；寫入再驗證 `X-CSRF-Token`。Cookie 為 `__Host-realms_session; Secure; HttpOnly; SameSite=Strict; Path=/`，不設 Domain。登入本身要求同源 JSON，不依賴既有 session；全程不使用 ChatGPT 登入。

## 公開資料

| 方法與路徑 | 輸入 | data 與結果 |
|---|---|---|
| GET /api/worlds | 無 | `{items: PublicWorld[], fetchedAt}`，無世界時 items=[] |
| GET /api/worlds/{worldId} | 公開 ID | `{world: PublicWorld, latest: Archive, fetchedAt}` |
| GET /api/worlds/{worldId}/archives | 公開 ID | `{items: Archive[], complete: true, fetchedAt}`，最新至最舊的全部可用歷史 |

`PublicWorld = {id, displayName, description, availability, fetchedAt}`；availability 為 available／temporarily_unavailable。description 為純文字，不渲染任意 HTML。資料只來自仍發布且目前連線可用的欄位；不回傳帳號、Realm 內部 ID 或成員資料。

`Archive = {id, kind, savedAt, sizeBytes, gameVersion}`；kind=latest／backup，savedAt、sizeBytes、gameVersion 可為 null；sizeBytes 為十進位字串。latest.id 固定為 latest，歷史 id 是網站接受的 opaque 選擇值，只在該欄位內有意義。清單不混入其他欄位，伺服器重新核對歸屬。

fetchedAt 是資料取得時間，不冒充存檔時間。歷史有分頁就全部遍歷後回應；列表不完整或欄位不可核對時回錯誤，不能用 complete=true 隱藏缺項。過長上游流程可以明確回應服務暫不可用，但不能只列前幾份便宣稱符合全部歷史需求；真實完整清單效能屬 G0／G3 驗證。

未知與未發布 worldId 統一 404 not_available。曾見舊畫面的訪客也得到相同回應及「世界目前未開放或無法使用」，不確認未公開內容存在。官方沒有提供歷史而核對成功可回空 items；服務錯誤不得回假空列表。仍有已發布設定但連線需要恢復時，首頁顯示暫時不可用，不偽裝成沒有發布世界。

## 下載準備與原生附件

| 方法與路徑 | 輸入／保護 | 結果 |
|---|---|---|
| POST /api/worlds/{worldId}/downloads | 同源 JSON；`{selection:{kind:"latest"}}` 或 `{selection:{kind:"backup",archiveId}}` | 202，`{jobId, statusSecret, state:"preparing", retryAfterSeconds, expiresAt}` |
| POST /api/downloads/{jobId}/step | `X-Download-Capability` 為 statusSecret、同源 JSON 空物件 | 202 準備中；200 ready 時回一次 `{jobId,state:"ready",ticket,expiresAt}` |
| GET /api/downloads/{jobId} | 同上 capability 標頭 | 200，`{jobId,state,stage,outcome,error,expiresAt}`，不回 ticket |
| POST /api/downloads/redeem | 原生 form POST，同源 Origin；欄位 ticket | 200 附件串流；開始前錯誤為無附件標頭的繁體中文 HTML |

建立請求先原子限流、主庫確認發布與連線、寫入工作及請求紀錄，不等待完整官方準備才回應。介面在按下時立即顯示準備中，以符合 2 秒回饋；狀態秘密只放頁面記憶體，不進 URL／localStorage／日誌。

step 驗證 capability、世代、發布、到期與 next_poll_at。每次只推進一個外部階段，短租約避免同時打上游；過早呼叫給 429 與 Retry-After。同一次 transition 只核發一次票據；若回應遺失，使用者重建工作，不靠 GET 取回票據。工作到期 10 分鐘；上游世界準備最多 20 次，間隔取官方值，沒有時初始 5 秒。上游要求較長間隔時照辦，不能以密集重試繞過。

歷史選擇不可替換為 latest 或另一 backup。票據有效 60 秒，摘要存 D1，綁定完整工作／歸屬／世代／發布版本。消耗是單一條件 SQL；重放統一 404 not_available。下架再發布仍使舊票失效。

兌換後取得上游，先確認 200、可接受的檔案媒體型別／實測規則及最多 4 KiB 的有界前綴。ZIP／mcworld 前綴驗證不能冒稱已驗完整壓縮檔；後續內容正確性由真實下載／匯入驗收證明。HTML／JSON 錯誤、206 或非預期回應不得成為附件。前綴檢查後先輸出原前綴再持續讀取，不能漏 bytes。

在開始附件前最後一次條件更新重新驗證連線、發布版本及工作狀態；下架／解除先完成就拒絕並取消上游。附件回應包含：

- `Content-Type: application/octet-stream`。
- `Content-Disposition: attachment; filename="world-backup.mcworld"; filename*=UTF-8''...`。
- 檔名含經正規化的網站名稱及 latest／歷史辨識，不用未知日期假造版本；移除控制字元、路徑分隔符及 CR／LF，提供 ASCII fallback。
- 只有來源可信且未改寫位元組時沿用 Content-Length；未知時省略。Range 不提供續傳，忽略後回完整 200 或開始前明確拒絕。
- 串流具背壓且傳遞取消，禁止 Buffer 全檔、Blob、落盤、Cache API、R2 與未消費分支。

串流中的錯誤使串流失敗，不能寫入 JSON 或新的世界版本。狀態查詢僅提供伺服器觀察；關閉原頁面不應取消已由原生下載接管的檔案傳輸。

## 網站帳號

| 方法與路徑 | 輸入 | 結果 |
|---|---|---|
| POST /api/admin/login | `{username,password}`，同源及雜湊前限流 | 200，安全 Cookie；`{username,csrfToken,expiresAt}` |
| GET /api/admin/session | 有效 session | `{username,csrfToken,expiresAt}`；CSRF 可重新輪替並更新摘要 |
| POST /api/admin/logout | session、CSRF、空物件 | 204，刪 session 並清 Cookie |
| POST /api/admin/password | session、CSRF；`{currentPassword,newPassword}` | 204，驗證舊密碼後更新、刪全部 sessions 並清 Cookie |

登入錯誤帳號與密碼都回 401 login_failed；不存在帳號仍做等價受限雜湊路徑，避免以明顯差異洩露帳號。改密碼亦受密碼驗證限流。舊密碼完成比對後的版本條件寫入，防止與重設競爭。維護見[維護契約](maintenance.md)。

## Microsoft 連線與世界發布

以下全部要求管理員；寫入另需 CSRF。

| 方法與路徑 | 輸入 | 結果 |
|---|---|---|
| GET /api/admin/connection | 無 | 連線 status、最近核對時間、安全原因，不回 token |
| POST /api/admin/connection/attempts | 空物件，既有連線須先解除 | 201，`{attemptId,userCode,verificationUri,expiresAt,retryAfterSeconds}` |
| POST /api/admin/connection/attempts/{attemptId}/step | 空物件 | 202 pending 或 200 authorized；遵守官方間隔 |
| DELETE /api/admin/connection/attempts/{attemptId} | 無 | 204，取消並清秘密；已終止可重複得到 204 |
| DELETE /api/admin/connection | 無 | 204，清授權、下架與世代失效；斷開狀態可重複得到 204 |
| GET /api/admin/worlds | 無 | 擁有 Realm／欄位的管理投影、來源時間及不可發布原因 |
| POST /api/admin/worlds/refresh | 空物件 | 200 新核對的管理列表；來源失敗明確回錯誤 |
| PATCH /api/admin/worlds/{worldId} | `{displayName?,description?}` | 200 更新後的網站顯示設定 |
| PUT /api/admin/worlds/{worldId}/publication | `{published,expectedVersion,acknowledgeAllArchives?}` | 200 發布狀態與新版本；版本競爭 409 |

首次發布及下架後重新發布都要求 acknowledgeAllArchives=true，介面先說明包含最新、全部現存及未來可用歷史存檔。發布前重新核對擁有權與欄位歸屬，空欄位或歸屬不明回 409。下架不需要再向上游成功查詢，直接以主庫版本生效。

Microsoft 授權開始可能尚需多段 HTTP；起始頁面只有官方明確回傳的驗證網址與 user code，絕不顯示本站 Microsoft 密碼欄位。工作只能由建立者且有效的網站 session 推進。網站密碼重設後尚未完成授權不能復活。

## 紀錄

GET /api/admin/logs，需 session；參數 `kind`（all／operation／download）、`cursor`、`limit`（1～100，預設 50），可選 worldId。伺服器永遠附加最近 30 天條件，游標不能繞過。

data 為 `{items,nextCursor}`。每項含 id、occurredAt、category、worldDisplayName、archiveLabel、stage、result、safeErrorCode、requestId，未知或不適用值為 null。不提供訪客個資分析或原始 IP。顯示「請求下載」「伺服器傳輸結束」「已確認失敗」「結果不明」，禁止「已成功匯入」。

## 錯誤對應

| 狀態／代碼 | 公開呈現 | 管理呈現 |
|---|---|---|
| 400 invalid_request | 請求格式不正確，重新操作 | 同左 |
| 401 login_failed／session_expired | 不適用一般下載 | 登入失敗或重新登入 |
| 403 forbidden | 操作不被允許，不揭露內容 | 同源／CSRF 驗證失敗 |
| 404 not_available | 世界目前未開放或無法使用；重新整理 | 可在安全紀錄查原因 |
| 410 archive_gone | 目前仍公開欄位的選定存檔已移除；重新選擇 | 同左 |
| 409 slot_unverifiable／version_conflict | 一般公開面使用 not_available | 無法核對欄位或設定已更新 |
| 429 rate_limited | 限制次數，顯示可重試時間 | 同左 |
| 503 connection_required | 暫時無法下載 | 需要重新連接，無原始 token |
| 503 temporarily_unavailable／protocol_incompatible | 暫時無法下載；稍後再試 | 安全的服務／版本原因 |
| 502 invalid_archive | 無法取得有效世界檔 | 來源狀態或格式驗證失敗 |

若既要保護未公開存在性又遇到外部錯誤，先通過主庫公開檢查才可顯示 archive_gone 等較具體內容。失效票據與不存在票據對外一致。
