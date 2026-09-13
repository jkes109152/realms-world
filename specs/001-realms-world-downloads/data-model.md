# 資料模型：Realms World

**日期**：2026-09-13

**依據**：[規格](spec.md)、[計畫](plan.md)

**狀態**：邏輯設計；尚未建立資料表或遷移。

## 共通規則

使用 D1 SQLite，UTC epoch 毫秒儲存時間，API 用 ISO 8601，介面以 `Asia/Taipei` 顯示。外部 ID 視為字串，避免 JavaScript number 精度問題。亂數使用密碼學安全來源；列舉及布林值有 CHECK 約束，查詢使用預備語句。

權限直接讀 `env.DB` 主庫；若引入 Sessions，使用 `first-primary`。跨 await 的先讀後寫不是交易；取得權利必須靠帶條件 SQL 的 RETURNING／changes。

## 實體關係

```mermaid
erDiagram
    admin_accounts ||--o{ admin_sessions : "建立"
    admin_accounts ||--o{ auth_attempts : "發起"
    realm_connections ||--o{ realms : "擁有"
    realms ||--o{ world_slots : "包含"
    world_slots ||--o{ download_jobs : "選定"
    download_jobs ||--o| download_tickets : "核發"
    download_jobs ||--o| download_attempts : "觀察"
```

管理員登入與 Microsoft 連線分離；網站登出不解除已完成連線，待完成授權則綁定有效網站工作階段。存檔描述只是外部來源暫時投影，不是持久備份目錄。

## 管理員與工作階段

### admin_accounts

| 欄位 | 規則 |
|---|---|
| id | 固定 1，主鍵與 CHECK，最多一列 |
| username | 2～64 字元，小寫英文字母、數字、底線、點、連字號；唯一 |
| password_hash | 含版本、參數、salt 與衍生結果的 scrypt 封裝 |
| credential_version | 正整數；改密碼或維護重設遞增 |
| created_at／updated_at | UTC 毫秒 |

密碼 15～128 個 Unicode 碼點、UTF-8 最多 1024 bytes，不截斷、trim 或正規化。使用 `scrypt(N=16384,r=8,p=5,maxmem=33554432,keylen=32)`、每次至少 16 bytes 隨機 salt、等時比較。成本須在 G0 實測，不以降低為快速雜湊通關。

### admin_sessions

欄位：`token_digest` 主鍵、`admin_id=1`、`credential_version`、`csrf_digest`、`created_at`、`last_seen_at`、`expires_at`。

32 bytes 隨機不透明 session 的 SHA-256 摘要入庫，原值僅放安全 Cookie。CSRF 原值只給驗證後的管理介面，D1 存摘要。閒置 30 分鐘或建立 12 小時後失效；每次管理請求驗證兩種期限及帳號版本，last_seen_at 續寫同樣包含版本條件。

登出刪除該列；改密碼／重設以 batch 更新雜湊、增加 credential_version 並刪除全部 sessions。登入在密碼比對後以原 credential_version 條件插入 session，避免重設期間舊密碼仍建立登入。

### maintenance_operations

`operation_digest` 主鍵、`action`（bootstrap／reset）、`performed_at`。保存部署維護秘密的單向摘要，不存原值。唯一插入與帳號變更同一 batch，重放唯一約束失敗使整批回滾；成功後移除部署維護秘密。此防重放摘要不依 30 天紀錄期限清除。

## 連線與授權

### realm_connections

固定 `id=1`；解除後仍保留非敏感世代列，避免刪除重建後 generation 回到零。

| 欄位 | 規則 |
|---|---|
| generation | 非遞減整數；開始新連接、取消及解除時推進 |
| status | disconnected、authorizing、connected、reauth_required |
| owner_xuid | 已核對擁有者穩定 ID；解除清空 |
| credential_box | AES-GCM 封裝，可為 null |
| token_version | 成功保存新授權時遞增 |
| refresh_owner／refresh_until | 短期刷新協調，失效可接手 |
| last_verified_at／last_error_code | 核對時間及安全錯誤代碼 |
| updated_at | 狀態變更時間 |

密文封裝含 format_version、key_id、每次新的 12 bytes nonce 及驗證標籤。AES-256-GCM 金鑰在 Sites 秘密，AAD 綁定用途、連線 ID、generation、格式版本。密文只含實際需要的 Microsoft token、Xbox P-256 證明私鑰、device／title／user／XSTS token、cookie 與有效期。

刷新租約初始 30 秒、每個上游 HTTP 最長 10 秒，多段刷新在持有租約時條件續租。回寫必須同時符合 status、generation、token_version、refresh_owner 及未到期條件；其他請求收到可重試的準備中狀態，不忙等。解密失敗或授權明確失效停止新下載；429／5xx 不冒充授權撤回。

### auth_attempts

欄位：`id`、`admin_session_digest`、`credential_version`、`connection_generation`、`status`、`encrypted_state`、`expires_at`、`next_poll_at`、`poll_owner`、`poll_until`、`created_at`。

狀態為 pending → authorized／cancelled／denied／expired／failed。密文保存 device code、必要 cookie 及分段 Xbox 進度；user code 和官方驗證網址只給目前管理員。每次 step 最多一個外部階段，原子取得短租約並遵守 next_poll_at。網站 session／版本失效、取消或世代改變後，清除秘密並拒絕晚到結果。

### 解除的原子範圍

同一 D1 batch 增加 generation、改 disconnected、清空帳號及 credential_box／刷新租約、清除待授權秘密、所有欄位下架且增加 publication_version、清除未開始下載工作的密文描述及票據，並新增安全紀錄。可能與新連接競爭的語句以預期 generation 約束。新連接須在解除完成後才開始。

## Realm、欄位與存檔

### realms

欄位：`id`、`source_realm_id`、`connection_id=1`、`connection_generation`、`verified_owner_xuid`、`source_name`、`availability`、`fetched_at`。目前世代的 source_realm_id 唯一。

僅保存已核對擁有權的 Realm；受邀項目不能轉成可發布世界。依實際官方回應判定可用性，不只憑到期旗標猜測。

### world_slots

| 欄位 | 規則 |
|---|---|
| id／public_id | 內部主鍵與隨機公開 ID；公開 ID 不包含帳號或 Realm ID |
| realm_id／source_slot_id | 組合唯一，關聯 Realm 及欄位 |
| connection_generation | 對應目前連線 |
| source_identity | 可靠的官方內容辨識投影；無法確認為 null |
| association_status | verified、empty、unverifiable、unavailable |
| display_name／description | 純文字 1～100／0～2000 碼點，不改官方資料 |
| published | 預設 false |
| publication_version | 發布、下架或歸屬失效時遞增；顯示文字修改不影響 |
| fetched_at／updated_at | 來源取得及設定更新時間 |

目前連線 connected、擁有權正確、欄位 verified 且非空才可發布。發布涵蓋未來可用存檔。欄位被替換或無法再確認歸屬時停止提供並下架，等待管理員重新確認，不沿用舊票。重新授權可保留顯示文字，但全部欄位仍未發布。

### 存檔投影

欄位：`archive_id`、`world_public_id`、`kind`（latest／backup）、`source_backup_id`、`association_evidence`、`saved_at`、`size_bytes`、`game_version`、`fetched_at`。

latest 是選擇器，不冒充固定歷史 ID；backup 保持原選擇。未知時間／大小／版本為 null；API size_bytes 使用十進位字串。歷史列表需取得完整上游結果，有分頁就遍歷；無法確認完整時明確失敗，不靜默截斷。只短期保存選擇與歸屬證據，準備下載時重新核對。

## 下載工作、票據與觀察

### download_jobs

欄位：`id`、`status_secret_digest`、`world_slot_id`、`connection_generation`、`publication_version`、`selector_kind`、`source_backup_id`、`association_evidence`、`state`、`stage`、`encrypted_descriptor`、`next_poll_at`、`step_owner`、`step_until`、`expires_at`、`safe_error_code`、`created_at`。

建立時產生 32 bytes 狀態秘密，D1 只存摘要，瀏覽頁只在記憶體保存。工作有效 10 分鐘；上游世界準備最多 20 次嘗試，遵守回應間隔，授權內部分段不重複建立世界準備請求。

狀態：preparing → ready → redeeming → streaming → transfer_ended／transfer_failed。準備可轉 failed／expired／invalidated。10 分鐘期限限制準備及新兌換，不因到期中止已開始的串流。缺少可靠終態時保留已觀察階段，紀錄 outcome=unknown，不以逾時推定成功或失敗。

encrypted_descriptor 包含上游 URL、Bearer token、到期及必要 headers，使用獨立用途 AAD，只在後端解密。開始串流、失敗、失效或過期即清空，禁止保存世界位元組。

### download_tickets

欄位：`ticket_digest` 主鍵、`job_id` 唯一、`connection_generation`、`publication_version`、`expires_at`、`used_at`。

32 bytes 原票有效 60 秒，只在轉 ready 的 step 回應一次；狀態查詢不能吐出原票，遺失或過期需重建工作。單一條件 UPDATE／RETURNING 確認未用、未過期、ready、連線有效、欄位仍發布及版本相符，才設 used_at。20 次並行兌換最多一次成功；上游失敗也不復活原票。

收到可用上游檔案後再條件更新 redeeming → streaming，此成功點定義「傳輸已開始」。若下架／解除先提交，更新失敗且取消上游，不能沿用準備前的權限。

### download_attempts

欄位：`id`、`job_id`、世界／版本安全快照、`requested_at`、`stream_started_at`、`observed_end_at`、`observed_bytes`、`outcome`、`safe_error_code`。

- 工作建立成功即寫請求事件。
- outcome=unknown 為初始值，包含進行中及缺少證據者，另以階段欄位說明。
- transfer_ended：來源正常 EOF、已讀資料交給輸出串流且無已知取消；已知 Content-Length 必須與觀察 bytes 相符。
- transfer_failed：有確定上游／輸出錯誤、取消、長度不符等證據。
- 結束寫入失敗維持 unknown；訪客回報不能單獨改成 transfer_ended。

任何狀態都不能宣稱訪客已落盤或成功匯入。

### audit_events

欄位：`id`、`created_at`、`category`、`actor`、`world_public_id`、可選安全存檔標籤、`result`、`safe_error_code`、`correlation_id`。涵蓋連接、解除、發布、下架、帳號維護與下載。禁止原始錯誤、秘密、上游 URL、成員名單及原始 IP。

## 限流與清理

rate_limit_windows 以 scope、key_digest、window_start 為組合主鍵，含 count、expires_at。原子 upsert 後判斷限額，來源及全站都計數；不以記憶體變數作跨請求權威。從平台可信來源取得 IP，透過獨立秘密 HMAC 與 UTC 日期產生當日識別；過期窗口最晚 24 小時後可清理。

maintenance_state 保存清理 owner／expires_at，每分鐘至多一批、每批 500 筆。查詢一律先檢查期限，清理失敗留待後续流量，不能使過期資料恢復可讀。

| 資料 | 有效／可讀期限 | 清理 |
|---|---|---|
| 操作與下載紀錄 | 最近 30 天 | 後續請求按時間索引批次刪除 |
| 授權工作秘密 | 官方到期，或取消／完成即失效 | 終止即清空，遺留列按請求清理 |
| 下載工作／票據 | 10 分鐘／60 秒，使用後不可再用 | 秘密即時清空；過期工作分批清理，不刪正在串流所需觀察列 |
| 網站工作階段 | 閒置 30 分鐘／絕對 12 小時 | 登出／重設即刪，過期列批次刪 |
| 保存的 Microsoft 授權 | 連線有效期間 | 解除立即清空，失效不提供新下載 |
| 維護防重放摘要 | 持續有效 | 不依一般紀錄期限刪除 |

索引包含 session 到期／管理員版本、授權工作到期、Realm／欄位唯一鍵、發布與世代、工作到期／狀態、票據摘要／到期、紀錄時間／世界、限流到期。D1 平台備份與應用程式可查閱期限不同，不宣稱刪除活動列會清除平台全部備份。
