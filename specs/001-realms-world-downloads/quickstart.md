# 快速開始與驗證指南

**日期**：2026-09-13

**依據**：[計畫](plan.md)、[HTTP 契約](contracts/http-api.md)、[維護契約](contracts/maintenance.md)

**狀態**：本次只有 SDD 文件。以下 npm 指令是實作階段必須提供的操作入口，目前沒有應用程式可啟動，不代表已通過驗收。

## 1. 前置條件

- Node 22.13.0 以上及 npm；本機已確認 Node 24.19.0，但 npm 尚不可用。實作時先從 Sites 支援的 runtime／套件管理安裝流程取得 npm，不變更不相關的全域設定。
- Git、專案本機 Spec Kit，以及對 GitHub realms-world 的權限。
- Sites 的建立、D1、秘密、保存版本與部署能力；第一個驗證 Site 仍是本產品同一個 Site。
- 管理員可親自完成 Microsoft 裝置碼授權，帳號擁有 Realm。
- 真實資料至少含可區辨的兩個世界欄位、非作用中欄位、一份不同歷史存檔及可用最新存檔；沒有資料就保留對應驗收未完成，不製造假證據。
- 至少一台可匯入 .mcworld 的相容基岩版裝置。實際最大世界大小於 G0 取得，不先猜容量。
- Bluehost DNS 管理權限只在正式網域階段使用，本規劃不修改 DNS。

## 2. 檢查目前 SDD

在專案根目錄執行：

```powershell
git branch --show-current
git status --short
$env:SPECIFY_FEATURE_DIRECTORY = Join-Path (Get-Location) 'specs/001-realms-world-downloads'
$env:SPECIFY_FEATURE = '001-realms-world-downloads'
& .\.specify\scripts\powershell\check-prerequisites.ps1 -Json -RequireSpec
```

預期分支為 `001-realms-world-downloads`，可辨識 research.md、data-model.md、contracts/、quickstart.md；[任務清單](tasks.md)已建立，若要一併檢查可加 `-RequireTasks -IncludeTasks`。文件修正與重複分析結果見[分析紀錄](checklists/analysis.md)，下一步執行 `$speckit-implement` 並先完成 T001 入口複查；本指南不取代任務清單或自行啟動全部實作。

## 3. 實作階段建立本機環境

Sites starter 若要求空目錄，先在獨立暫存目錄建立，再合併必要新檔至本儲存庫；保留 SDD、技能及 Git。沿用 starter 鎖定版本，宣告 D1 DB，不宣告世界 R2 儲存。

實作必須提供以下 package scripts：

| 指令 | 行為 |
|---|---|
| npm run db:migrate:local | 對本機 D1 套用已版本化遷移 |
| npm run dev | 啟動平台支援的本機開發伺服器，輸出實際網址 |
| npm run check | TypeScript 與必要靜態檢查，不連正式帳號 |
| npm run test:unit | 純邏輯、欄位驗證、時間單位、簽章與錯誤映射 |
| npm run test:integration | Workers／D1 競爭、權限與生命週期測試 |
| npm run test:e2e | Playwright 主要流程與介面驗收 |
| npm run test:stream | 3 個各至少 1 GiB 的即時模擬串流及並行瀏覽 |
| npm run admin:maintain -- --action bootstrap | 互動、無密碼回顯的受保護帳號初始化 |
| npm run admin:maintain -- --action reset | 同樣保護的密碼維護重設 |
| npm run build | 使用 starter 生產建置入口 |

先把本機秘密檔加入 .gitignore，再依維護契約設定人工測試秘密。初始 DOWNLOADS_ENABLED=false；沒有真實 Client-Version／來源主機時不能假裝真實轉接器可用。

```powershell
npm ci
npm run db:migrate:local
npm run check
npm run test:unit
npm run test:integration
npm run build
npm run dev
```

測試連正式服務必須與預設測試分開，不能讓 npm test 自動要求 Microsoft 登入。測試 fixture 不含真實世界、token 或私人上游回應。

## 4. G0：先驗證真實 Sites 與協定

建立最小受管理員保護的能力驗證入口，使用與正式功能相同的後端轉接器、資料庫、發布及串流服務。管理員先核對並明確發布選取的驗收欄位，驗證入口仍檢查發布／擁有權與版本；Sites 外層保持受保護、DOWNLOADS_ENABLED=false，公開資料與下載路由均停用。保存 Git 提交後經 Sites 建立版本與部署，不以本機 workerd 結果代替正式環境。

逐項執行並保存安全證據：

1. 驗證 D1 binding、遷移、原子條件 UPDATE、batch 回滾與秘密讀取。確認 20 次同票競爭只有一次取得權利；秘密不能從瀏覽器包或公開回應讀取。
2. 在 Sites 執行正式 scrypt 參數，量測外部請求延遲及平台 CPU／記憶體；不能只用 Worker 內未經 I/O 的 Date.now() 量純 CPU。若平台限制不符，記錄失敗，不能悄悄降低密碼成本。
3. 初始化管理員，登入後啟動裝置碼；管理員親自至 Microsoft 官方頁面授權。驗證分次輪詢、拒絕、取消、過期及降速，不收集 Microsoft 密碼。
4. 跨獨立請求、冷啟動及新網站登入重新讀取加密狀態；完成一次真實 refresh token 續期與 XSTS 重建，記錄安全時間／版本結果。
5. 核對穩定擁有者 ID；排除受邀 Realm。以至少兩個內容可辨識欄位，證明最新與歷史歸屬，包含非作用中欄位。記錄真正回應欄位與映射規則，不只記 HTTP 200。
6. 確認接受的 REALMS_CLIENT_VERSION、精確來源主機、每跳 redirect 及授權標頭政策；正常下載不得讓訪客看到上游 URL／token。
7. 使用 T023 最小發布操作確認完整歷史範圍，逐一發布驗收欄位後，從管理員驗證入口下載一份最新及一份不同歷史；不開啟公開總開關。確認內容對應選擇、記錄大小，其中至少一份由管理員在基岩版匯入並確認世界內容。
8. 下載實際最大世界，記錄 bytes、耗時與實際結果；驗證未知大小、慢速來源、斷線取消及 Sites 前置層是否截斷。
9. 執行大型模擬串流與同時瀏覽，確認不因全檔緩衝耗盡記憶體；應用程式／D1／物件儲存中不得留下世界副本。
10. 競爭驗證刷新與解除同時完成、取消後晚到授權、下架後舊票、下架再發布舊票、授權失效及備份消失；過時 reset 的帳號／sessions／操作摘要整批不變，冷啟動及並行 step 不繞過 20 次準備上限。
11. G0 結束或中止前下架本次驗收欄位，確認舊票失效、公開總開關仍關閉；意外中斷則下次先完成此清理。正式開放時重新確認發布範圍。

G0 任何必要項目失敗都阻止 G1／G2 完整產品實作。紀錄失敗、平台限制與需調整決策；不改外部主機、不刪除歷史需求、不拿模擬串接當真實成功。缺少使用者授權或遊戲匯入確認時，相關項目保持未完成。

## 5. G1～G3：功能與自動化驗收

在本機及對應的 Sites 測試版本執行：

一般匿名頁面／API 情境可在本機以人工資料與 DOWNLOADS_ENABLED=true 驗證，測試後恢復停用；Sites 此階段仍以受保護入口驗證真實核心。這些證據分別標示環境與授權層，不能宣稱已驗證正式網域的匿名可達性；後者留待 T092。

```powershell
npm run check
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:stream
npm run build
```

| 驗證情境 | 可重現步驟與預期結果 |
|---|---|
| 匿名最新下載 | 全新瀏覽器狀態從首頁最多 3 個主要操作發起下載；20 次均對應選定世界，無網站／Microsoft／ChatGPT 登入 |
| 全部歷史 | 與官方目前可用清單逐項比對、時間由新到舊；選定不同歷史不被換版，來源移除後明確不可用 |
| 發布隔離 | 同 Realm 兩欄位只發布一個；改 ID、舊票、未登入管理、未知欄位都拒絕且不洩露未公開存在 |
| 欄位內容變更 | 模擬替換或歸屬不能核對，自動停止提供並下架，重新確認前不可下載 |
| 工作階段 | 登出、閒置、絕對到期、改密碼／重設後全部舊 session 無效；與舊登入競爭亦無法放行 |
| 重設版本衝突 | 過時版本回 409，帳號／全部 sessions／操作摘要保持原狀；操作者讀新版本並確認後，未消耗秘密仍可成功一次 |
| 授權解除 | 清除保存秘密並下架全部世界；晚到刷新不能復活，再連接也不自動發布 |
| 失敗與限流 | 官方 429、5xx、準備中、token 過期、無世界及存檔消失均顯示正確訊息／重試時間 |
| 錯誤檔案 | HTML／JSON、非預期狀態與無效前綴不能成為 .mcworld；開始後斷流不追加錯誤文字或重送 |
| 大檔與瀏覽 | 3 個各至少 1 GiB 即時生成串流完整完成，同時 20 次頁面均可操作；來源不落盤，無整檔 Buffer／Blob |
| 效能 | 外部正常且網路穩定時，20 次列表／世界頁至少 19 次在 5 秒內可操作；按下載後 2 秒內可見回饋 |
| 紀錄 | 來源正常 EOF、確定中斷、結束寫入失敗分別為傳輸結束、已確認失敗、未知；無「已匯入」宣稱 |
| 30 天期限 | 人工時間與資料包含期限前後；過期查不到，後續請求批次清理；無流量不聲稱當刻物理刪除 |
| 期限與觀察 | 超過 10 分鐘的串流仍可查狀態，未開始工作不可兌換；30 天內準備到期不刪紀錄，超過 30 天清理不取消傳輸，晚到結果不重建紀錄 |
| 準備上限 | 冷啟動、重複／並行 step 仍最多保留 20 次上游準備機會；授權分段不計入，續期後重送要計入，失敗／逾時不退次數，第 21 次不呼叫上游 |
| 分段取得裝置碼 | requesting_code 時顯示準備中、不產生空登入連結；後續 pending 首次取得 challenge 才顯示官方網址；取消／到期／session 刪除後晚到結果無效 |
| 介面 | 登入、連接、發布、下架、最新／歷史下載在 360／1440 px、200% 文字與只用鍵盤皆可完成 |
| 秘密檢查 | 公開回應、附件 headers、瀏覽器包、一般日誌與 Git diff 不含密碼、授權、上游 URL 或未公開世界 |

模擬來源即時產生可計數的 bytes，下載接收端採串流計數／雜湊，不在應用伺服器保存檔案。真實 .mcworld 只下載至管理員驗收裝置，不加入專案或 Git。不能以「3 GiB 模擬通過」取代真實最大世界及遊戲匯入。

## 6. 驗收證據

實作時建立繁體中文驗收紀錄，使用以下欄位；不得放秘密：

| 欄位 | 內容 |
|---|---|
| 日期／執行者 | 台灣時區時間與管理員／自動測試 |
| Git／Site 版本 | 完整提交 ID、保存版本 ID 與實際部署環境 |
| 測試代碼 | 對應 G0、FR、SC 及案例名稱 |
| 輸入條件 | 安全世界標籤、欄位、latest／歷史、大小已知與否、並行數 |
| 觀察 | HTTP／安全代碼、bytes、耗時、來源及輸出觀察，無原始敏感回應 |
| 結果 | 通過、失敗或未執行，附可重現原因 |
| 遊戲匯入 | 基岩版版本、實際操作者確認與世界辨識；不能由 HTTP 結束代填 |

本次狀態：文件研究與設計已完成；上述所有應用測試、Sites 驗證、真實授權、下載及匯入均未執行。

## 7. G4：正式網域與 Git 交付

T089 先完成部署前驗收：G0、五個故事與 T080～T088 通過，FR-001 的正式網域部分及 SC-010 的正式入口整合明列未執行，其他功能及安全前置證據須通過。此時只批准部署，不能宣告正式入口已完成。

T090 在 Sites 套用秘密與資料庫遷移，保存／部署對應 Git 完整提交的版本，DOWNLOADS_ENABLED 仍關閉。T091 取得 realms.jkesbyebye.com 的實際驗證／路由記錄，再於 Bluehost 設定；不猜 CNAME 或 A 目標，等待並確認 DNS、憑證與 HTTPS。

T092 核對無遺留 G0 發布，由管理員重新明確選取正式欄位並確認全部歷史範圍，才套用外層公開存取及 DOWNLOADS_ENABLED=true。正式網域驗證匿名最新／歷史、自製管理登入、隔離及紀錄，補齊 FR-001／SC-010；全部 FR／SC 均有通過證據才完成正式驗收。失敗立即關閉新公開下載，修正並重驗，不能把等待中的 DNS 或憑證標成完成。

功能經 PR 交付 main，依儲存庫規則完成審查與檢查。只有 PR 實際已合併、main 包含合併結果、無新增未合併工作，才同步本機 main 並刪除本機／遠端功能分支、prune、驗證均不存在。計畫階段保留功能分支供後續任務與實作。
