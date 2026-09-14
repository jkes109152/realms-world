# 正式網域部署與 DNS 紀錄

**日期**：2026-09-15（台灣時間）

## 使用者授權與驗收狀態

使用者要求以 Sites 部署目前專案至 `realms.jkesbyebye.com`，透過內建瀏覽器在 Bluehost 只新增必要 DNS，不修改其他設定；另明確回覆「同時開放所有訪客下載」。因此本次依使用者最新指示提前開放已發布的 latest 範圍，保留所有未發布欄位為私有。

這是本次發布時程的明確調整，不是 G0 或完整任務驗收通過。使用者先前回覆「尚未匯入」，遊戲匯入及內容確認、大型負載／競爭與其他未完成任務仍保留待驗證；不改寫成成功。既有登入、Origin、CSRF、票據、精確來源、發布與世代檢查維持啟用。

## DNS 新增範圍

| 類型 | Bluehost 主機名稱 | 用途 | TTL |
|---|---|---|---|
| CNAME | realms | 指向 Sites 回傳的 custom-domains.chatgpt.site. | 4 小時 |
| TXT | _openai-site-verification.realms | Sites 網域所有權驗證 | 4 小時 |
| TXT | _cf-custom-hostname.realms | 自訂主機驗證 | 4 小時 |

內建瀏覽器顯示兩次儲存成功，原有 game CNAME 及其兩筆 TXT 的名稱、值與 TTL 保留，總筆數由 3 增為 6。未更動根網域、Nameservers、DNSSEC、郵件、續約或其他產品設定。作業系統 DNS 查詢亦取得新增 CNAME 與兩筆正確 TXT。

## Sites 部署

- 沿用同一 Site 與已驗證的版本 10，來源 `f9362b5eb5347f8eb50bfe47be084fd6378b43a5`，未另建網站。
- 僅更新 SITE_ORIGIN=`https://realms.jkesbyebye.com`、DOWNLOADS_ENABLED=`true`，其餘環境值與秘密保持不變；環境 revision 7。
- 2026-09-14 16:09:16.386197 UTC 部署成功；依使用者明確選擇將 Site 存取設為 public，存取 revision 2，既有編輯者及名單未另修改。
- 公開範圍只有已發布的「又大又多房子世界」，latest、verified；其餘 5 個欄位仍未發布。
- 2026-09-14 16:14:19.782219 UTC，Sites 回傳 hostname status、provider_status、ssl_status 均為 active，last_error=null。初始憑證等待時的 SSL 失敗及路由傳播期間短暫「找不到工作站」不計成功；啟用後以正常 HTTPS 重新開啟，未略過憑證檢查。

## 正式網址匿名實測

- 內建瀏覽器首次進入正式網域，未登入網站帳號；首頁直接顯示唯一已發布世界及最新下載按鈕，不再顯示管理員預覽或 ChatGPT 登入入口。
- 2026-09-14 16:14:51.124 UTC 建立新的匿名 latest 工作。首次準備遇到 503，後續遵守同工作租約及重試間隔而恢復 ready，沒有自動新增另一個工作或返回舊世界。
- 原生表單由正式網域送往 `/api/downloads/redeem`。串流於 16:16:44.517 UTC 開始、16:16:45.100 UTC 結束；D1 outcome=transfer_ended、observed_bytes=11418860、safe_error_code=null；首頁顯示「伺服器傳輸結束」。
- 使用者裝置新增 `又大又多房子世界-latest (2).mcworld`，11,418,860 bytes，與伺服器觀察一致。SHA-256 為 `5f6dca21e2073774be915c289d700b2f7bb42c7187830ecc7286235782c9acfc`，14 個 ZIP 項目可讀，包含 level.dat、levelname.txt 與 db/。此結果不證明已匯入遊戲。
- 同一未登入瀏覽器進入 `/admin/verification`，只顯示網站帳密登入表單，未取得世界管理或 Microsoft 授權控制。新網域使用獨立的 Host-only Cookie，原帳號仍可使用，Microsoft 連線不因網域變更而清除。
- 自動化命令列直接讀取 Sites URL 遇到 Cloudflare 瀏覽器檢查，沒有繞過該檢查；本次公開頁與下載證據來自正常內建瀏覽器操作。

## 管理頁文字修正

正式開放後，管理頁仍有寫死的「公開下載關閉／未開放公開下載」及只限驗證的操作提示。改為「管理員專用」「世界與發布範圍」等與實際功能相符的文字；未修改登入、發布、下架或下載邏輯。此文字修正另以同一 Site 部署，沿用已完成的匿名下載核心驗證。

版本 11 的來源為 `2ec580bab510d5a7a681c3d2f62b97e8e7fdaeac`，環境 revision 7，於 2026-09-14 16:21:40.432890 UTC 部署成功；TypeScript、ESLint 與五階段生產建置通過。內建瀏覽器重新載入正式管理頁，確認「管理員專用／世界與連線管理」新文字，再回首頁確認公開世界與下載按鈕正常。沒有因純文字修正重複執行相同世界下載。

T091 的 DNS／HTTPS 設定與驗證已完成；T092 的完整驗收仍未完成。網站已依本次使用者明確要求公開，PR 保持草稿，沒有宣稱所有功能驗收或遊戲匯入完成。

## 舊網域登入入口修正

使用者回報登入顯示「這項操作未獲授權」。2026-09-14 16:28:26 至 16:29:24 UTC 的五筆 `/api/admin/login` 403 紀錄，其 Host、Origin 與 Referer 均為舊的 `realms-world-jkesbyebye.jkes109152.chatgpt.site`，Sec-Fetch-Site 為 same-origin。來源與正式 SITE_ORIGIN 不同，因此在密碼驗證前被拒絕，並非已確認的密碼錯誤。

新增首頁與 `/admin` 頁面導覽的正式網域轉址：GET／HEAD 在非正式來源時以 307、no-store 前往 SITE_ORIGIN 對應路徑，目的地不採信查詢參數或 X-Forwarded-Host，且不轉送查詢內容與 Referer。正式網域不轉址；POST、API、密碼、CSRF 與下載票據不轉送。精確 Origin 驗證、Host-only Cookie、Microsoft 連線與既有公開範圍保持原狀。本次未更動任何 DNS。

以人工來源驗證舊入口轉址、正式入口不循環、不採信外部目的地及不轉送寫入，連同現有安全原語共 14 項測試通過，TypeScript、ESLint 與生產建置均通過。版本 12 來源為 `845480f83221108489f421f3ddf9624cd1319684`，環境 revision 7，於 2026-09-14 16:40:04.001671 UTC 部署成功。

部署後在內建瀏覽器輸入舊 `/admin/verification` 網址，實際落在 `https://realms.jkesbyebye.com/admin/verification` 並顯示登入表單，未出現循環或登入前管理資料。已開啟正式登入頁請使用者自行輸入原帳密；帳密實際登入結果仍待使用者確認，未讀取密碼或宣稱已登入成功。
