# 帳號與秘密維護契約

**日期**：2026-09-13

**依據**：[計畫](../plan.md)、[資料模型](../data-model.md)

**狀態**：待實作；不包含實際帳號或秘密。

## 初始管理員與忘記密碼

第一版選擇獨立部署秘密保護的維護 API，配合維護 CLI。它只在管理 Sites 的操作者部署一次性秘密後可使用，平時無有效入口；資料庫空白不會開放匿名註冊。不把 Sites 使用者身分當成網站登入身分。

操作順序：

1. 在受保護終端互動輸入網站帳號與新密碼，CLI 不回顯密碼、不從指令列參數接收密碼，依資料模型產生 salt 及 scrypt 雜湊。
2. 產生至少 32 bytes 一次性維護秘密，只透過 Sites 的秘密管理設為 `MAINTENANCE_TOKEN`，保存版本並套用部署；不要輸出至聊天、Git、一般日誌或環境範例。
3. CLI 用 HTTPS 呼叫 POST /api/maintenance/admin，`Authorization: Bearer ...` 帶該秘密，JSON body 為 `{action,username,passwordHash,expectedCredentialVersion}`。bootstrap 的 expectedCredentialVersion 為 null；reset 必須與目前版本相符。
4. 後端先等時驗證部署秘密、方法、內容型別與最多 16 KiB body，再驗證雜湊版本／參數。以同一 batch 唯一插入 operation_digest 並建立唯一 id=1 管理員，或條件更新密碼／credential_version 並刪除全部 sessions。
5. 同一秘密重放必須被唯一約束拒絕，整批回滾。bootstrap 已有帳號則 409；reset 版本不同則 409，不覆寫較新設定。資料庫變更結果不明時查操作摘要及版本，不盲目重試改寫。
6. 成功回應 200 `{action,credentialVersion}`，不回雜湊或秘密。立即從 Sites 移除 MAINTENANCE_TOKEN，再套用版本；其防重放摘要仍保留。
7. 使用新密碼登入；舊密碼與全部舊工作階段驗證為失效。

CLI 可用 GET /api/maintenance/admin/version 讀取 `{initialized,credentialVersion}`，同樣要求當次部署秘密；此讀取不消耗操作。不存在／無效秘密統一 404；不向匿名請求提供是否初始化等狀態。維護端點不靠管理 Cookie 授權，禁止瀏覽器 CORS，操作只記安全結果。

passwordHash 是受驗證的固定 scrypt 封裝；雖非明文密碼，仍屬敏感資料，不進日誌或 Git。伺服器不接受任意低成本算法／參數。CLI 初始計畫入口為 `npm run admin:maintain -- --action bootstrap` 或 reset；使用互動輸入，不將秘密放命令列。

## 環境與秘密

| 名稱 | 類型 | 用途 |
|---|---|---|
| DB | Sites D1 binding | 設定、加密狀態、紀錄 |
| SITE_ORIGIN | 非秘密設定 | 精確 origin，正式使用 realms.jkesbyebye.com |
| REALMS_CLIENT_VERSION | 非秘密設定 | G0 實際接受的遊戲服務版本 |
| REALMS_DOWNLOAD_HOSTS | 非秘密設定 | G0 已確認精確 HTTPS 下載主機 |
| REALMS_DOWNLOAD_REDIRECT_POLICY | 非秘密設定 | 已驗證主機對及最小授權轉送政策，預設空且拒絕跨主機 |
| AUTH_KEYRING | 秘密 | key ID 至 32 bytes AES 金鑰的對應 |
| AUTH_ACTIVE_KEY_ID | 非秘密設定 | 新寫入使用的 key ID |
| RATE_LIMIT_HMAC_KEY | 秘密 | 日更來源識別，不與加密金鑰共用 |
| MAINTENANCE_TOKEN | 暫時秘密 | 每次 bootstrap／reset 一次性使用，完成即移除 |
| DOWNLOADS_ENABLED | 非秘密設定 | 正式驗收前 false；全站停用新公開下載 |
| 限流設定 | 非秘密設定 | 沿用計畫初始值，經負載驗證後可調整 |

G0 未確認 Client-Version 或主機政策前，使用明確「未設定」狀態並拒絕該能力，不填猜測值。DOWNLOADS_ENABLED 是公開下載總開關；G0 真實下載透過相同服務的受管理員保護驗證入口測試，不能先開放世界給匿名訪客。

秘密透過 Sites 的環境變數介面設 `is_secret=true`，再部署保存版本套用；不能假設修改秘密立即改變正在執行的版本。`.openai/hosting.json` 只放平台要求的 Site／D1 能力資訊，不放 secrets。

本機開發秘密檔必須先加入 .gitignore，範例只列鍵名與「自行設定」。使用人工測試 token，禁止複製真實 refresh token 至 fixture。應用程式 build 不能將 server-only 模組或環境值打包到瀏覽器。

## 金鑰輪替與故障

AUTH_KEYRING 同時保留目前與前一把必要金鑰；新寫入使用 active key。受保護維護流程分批解密／重新加密現有授權與未過期短期秘密，每次新 nonce，條件更新防止覆寫較新 token。確認沒有資料再引用舊 key ID 才移除舊金鑰。

不能解密時拒絕新下載，提示管理員恢復正確秘密或重新連接，不能以空授權、明文儲存或重置成公開狀態掩蓋錯誤。回復 Git 版本不代表資料庫與授權狀態可以倒退；已套用遷移不可任意重寫或回復，優先前向修正。

## 維護驗收

- 沒有部署秘密、錯誤秘密、重放秘密、匿名 bootstrap、第二管理員均被拒絕。
- 正確 bootstrap 一次成功；reset 與後台改密碼競爭不覆寫較新版本。
- 舊密碼登入與 reset 同時完成時，舊 credential_version 無法插入有效 session。
- 秘密移除後維護入口不可用，防重放摘要仍存在。
- 密碼、passwordHash、授權權杖與來源 URL 未出現在瀏覽器包、一般日誌、Git 或公開回應。
