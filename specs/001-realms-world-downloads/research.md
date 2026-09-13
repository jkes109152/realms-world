# 技術研究：Realms World 公開世界下載站

**日期**：2026-09-13

**依據**：[功能規格](spec.md)、[專案憲章](../../.specify/memory/constitution.md)

**狀態**：文件與原始碼研究完成；真實 Sites／Microsoft／Realms 驗證尚未執行。

## 1. 同一個 Sites 全端應用程式

**決策**：採 Sites 現行 React／TypeScript／vinext starter，在同一個 Cloudflare Worker 提供頁面、管理 API、授權與下載。D1 綁定使用 `DB`，只保存設定、加密授權、短期工作與紀錄。世界檔不使用 R2、Cache API、檔案系統或其他持久儲存。

**理由**：符合既定託管與匿名入口要求；現行 Sites 支援 D1、部署秘密及公開存取。自製管理員登入使用 `/admin/login`，不使用平台保留的 ChatGPT 登入路徑。Sites 外層公開設定與應用程式後台保護是兩個獨立檢查點。

**替代方案**：外部 Node 伺服器、R2 世界封存、Cloudflare Access 或 ChatGPT 登入均不符合本版選定範圍，不採用。Sites 未承諾的 Cron、Durable Objects、Queues 或 KV 不加入設計。

**查核依據**：本機 Sites 插件 0.1.62 的建置／託管技能、`references/project-setup/portable.md`、`references/authentication.md`、`references/persistence-and-storage.md`，以及 Sites 工具對 D1、秘密、公開設定與自訂網域的契約。這些資料證明平台介面存在，不能證明本應用程式已成功部署。

## 2. 版本與測試環境

**決策**：實作時以當時 Sites starter 的鎖定檔為準；本次查核版本為 Node 最低 22.13.0、TypeScript 5.9.3、React 19.2.6、vinext 1.0.0-beta.5、Vite 8.0.13、Wrangler 4.92.0、Drizzle ORM 0.45.2／Kit 0.31.10、Tailwind 4.2.1。使用 `nodejs_compat`；不把整個 Node 生態視為相容。

**理由**：維持平台既有建置路徑，避免因自行升級引入無關差異。SQL schema 由 Drizzle 管理遷移，查詢使用 D1 預備語句；已套用的遷移不可改寫，不在一般請求執行 DDL。

**驗證選擇**：純邏輯與 Worker 整合使用 Vitest 4.1 以上及 `@cloudflare/vitest-plugin`，實作時鎖定相容版本；瀏覽器流程使用 Playwright。舊的 Workers pool 範例不作新專案基準。[Cloudflare 官方測試指南](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)

**本機現況**：已找到 Node 24.19.0；目前 PATH 與已查核的內建 Node 目錄未提供 npm。尚未安裝依賴；快速開始指南將 npm 列為實作準備條件，不把未執行的測試列為通過。

## 3. Microsoft／Xbox 授權採薄型轉接器

**決策**：以原生 `fetch`、Web Crypto 及必要的 Node 相容加密介面實作小型轉接器。PrismarineJS 作協定參考，不直接使用其檔案快取、長時間輪詢或全檔下載 helper。

第一個相容性驗證固定參考：

- prismarine-auth：`b795199dc5fa26059655bb1bc91c7f7f2733b232`。
- prismarine-realms：`39787ccf0109e0135c8968b0d0e81f4ebbeac200`。
- `live` 流程、Minecraft Nintendo Switch title：`client_id=00000000441cc96b`、`deviceType=Nintendo`、scope 為 `service::user.auth.xboxlive.com::MBI_SSL`。
- Microsoft token → Xbox user／device／title token → Realms 專用 XSTS。
- XSTS relying party 為 `https://pocket.realms.minecraft.net/`；Realms 標頭為 `XBL3.0 x={userHash};{XSTSToken}`。不使用 multiplayer relying party、Minecraft multiplayer chain 或 PlayFab 作替代。
- `REALMS_CLIENT_VERSION` 為必要部署參數，值由真實驗證確認，不能直接以套件的 `0.0.0` 預設值宣稱可用。

**理由**：現有參考流程包含檔案快取與跨請求授權狀態；下載 helper 會讀取整個 Buffer。第三方套件可作研究來源，但不代表 Microsoft 保證支援第三方網站使用此 title。

**授權生命週期**：裝置碼從 Microsoft 提供的 HTTPS 頁面完成。開始呼叫 `oauth20_connect.srf`，每次網站輪詢最多向 `oauth20_token.srf` 查詢一次，遵守官方回應的間隔、降速及到期時間。加密保存 device code、必要 cookie、refresh token、Xbox 證明金鑰與相關快取。時間單位統一換算成 UTC 毫秒，`expires_in` 的秒必須乘以 1000。續期以條件更新及短租約協調；取消、解除或被新世代取代的請求不得回寫有效連線。

**替代方案**：整套 PrismarineJS 的生命週期不符合本平台；自建 Azure application／MSAL 尚未證明具相同 Realms title 權限，不在相容性失敗時自動切換。

**來源**：[授權流程](https://github.com/PrismarineJS/prismarine-auth/blob/b795199dc5fa26059655bb1bc91c7f7f2733b232/src/MicrosoftAuthFlow.js)、[Live token](https://github.com/PrismarineJS/prismarine-auth/blob/b795199dc5fa26059655bb1bc91c7f7f2733b232/src/TokenManagers/LiveTokenManager.js)、[Xbox 簽章](https://github.com/PrismarineJS/prismarine-auth/blob/b795199dc5fa26059655bb1bc91c7f7f2733b232/src/TokenManagers/XboxTokenManager.js)、[Microsoft 裝置碼說明](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)、[Realms 授權格式](https://github.com/PrismarineJS/prismarine-realms/blob/39787ccf0109e0135c8968b0d0e81f4ebbeac200/src/util.js)。

## 4. 歷史存檔的欄位歸屬是必要實測門檻

**決策**：只公開經轉接器可靠確認歸屬的資料。不能確認時回傳 `slot_unverifiable`，阻止發布或新下載；不得把 Realm 級歷史列表複製至所有欄位，也不得為查詢自行切換作用中欄位。

**研究結果**：

| 能力 | 原始碼已確認 | 尚須真實驗證 |
|---|---|---|
| Realm 與欄位 | `GET /worlds`、`GET /worlds/{realmId}` | `ownerUUID` 與 XSTS 穩定帳號 ID 的關係、空欄位及 options 結構 |
| 歷史列表 | `GET /worlds/{realmId}/backups` | 回應是否足以辨識每個欄位、是否有分頁及完整歷史 |
| 最新下載 | `GET /archive/download/world/{realmId}/{slotId}/latest` | 非作用中欄位、準備中及重試行為 |
| 指定歷史 | `GET /archive/download/world/{realmId}/{slotId}/{backupId}` | 指定 ID 確實屬於該欄位且檔案內容相符 |
| 檔案 | `downloadLink`／`downloadUrl`、可選 `token` 與 `size` | CDN 確切主機、重新導向、檔案類型及長連線行為 |

`getRealmBackups(realmId, slotId)` 的 HTTP 請求沒有傳送 slotId；slotId 只是附加在本機物件。因此方法簽名不能作為欄位隔離證據。最新端點雖描述目前世界，本產品仍只承諾官方當時可下載者，不宣稱涵蓋未儲存進度。

**替代方案**：只支援作用中欄位、取消歷史下載、以顯示名稱推測擁有者或歸屬，均會改變已確認需求，不採用。

**來源**：[列表方法](https://github.com/PrismarineJS/prismarine-realms/blob/39787ccf0109e0135c8968b0d0e81f4ebbeac200/src/index.js)、[基岩版端點](https://github.com/PrismarineJS/prismarine-realms/blob/39787ccf0109e0135c8968b0d0e81f4ebbeac200/src/bedrock/api.js)、[下載實作](https://github.com/PrismarineJS/prismarine-realms/blob/39787ccf0109e0135c8968b0d0e81f4ebbeac200/src/structures/Download.js)、[官方備份說明](https://help.minecraft.net/hc/en-us/articles/28717462139149)。

## 5. 大型下載只使用有背壓的串流

**決策**：瀏覽器先建立短期下載工作，分次觸發準備，再用原生表單 POST 取得附件。上游網址與 Bearer token 只在後端使用。傳輸以 `ReadableStream` 有界讀取、傳遞取消訊號與背壓；不用整檔 `Buffer`、`arrayBuffer()`、`blob()` 或分支後無限累積的 `tee()`。

**理由**：Worker 每個 isolate 的 128 MB 記憶體由並行請求共用，不能按世界大小配置記憶體。HTTP 串流在連線持續時可長時間執行；Sites 額外配額仍須實測。成功僅代表伺服器觀察到資料來源正常結束並交付串流，不能證明瀏覽器落盤或遊戲匯入。

**請求控制**：第一版對建立下載、輪詢與登入設原子頻率限制；3 個並行下載是驗收負載，不是硬性三人上限。不引入需要整段下載定期 D1 心跳的並行租約。如此不因每次 invocation 的 D1 查詢上限額外限制大型世界的傳輸時間。已合法開始的傳輸不受後續限流中斷。

**來源邊界**：訪客不能提交 URL。轉接器僅允許能力驗證所確認、列入部署設定的精確 HTTPS 主機；每次重新導向都重新檢查，最多 3 次。Bearer token 不自動跨主機轉送；需由已驗證的端點／主機政策明確允許。禁止私有位址、IP literal、userinfo、非標準埠與任意代理。缺少已確認主機設定時拒絕下載。

**替代方案**：瀏覽器 fetch 後轉整檔 Blob、背景封存、外洩上游簽署 URL 均不符合授權與串流要求。

**來源**：[Workers Streams](https://developers.cloudflare.com/workers/runtime-apis/streams/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)。

## 6. 管理員、秘密與資料一致性

**決策**：唯一管理員使用 scrypt 密碼雜湊、隨機不透明工作階段及同源 CSRF 防護。可重用的 Microsoft 授權以 AES-256-GCM 加密，金鑰由 Sites 部署秘密提供，D1 只存密文、nonce 與 key ID。詳細參數與維護契約見[資料模型](data-model.md)及[維護介面](contracts/maintenance.md)。

**理由**：不以快速 SHA-256 儲存密碼，不將可撤銷工作階段做成不查資料庫的長期 JWT。D1 原子條件更新及 batch 負責重放、發布版本、連線世代與續期競爭；不得將跨 await 的讀取及寫入當作交易。

**替代方案**：PBKDF2 的高迭代建議與 Workers 已知運算限制有衝突；本機執行成功不等於 hosted Worker 接受，故選原生 scrypt 作首選並排入實際 CPU／記憶體驗證。直接使用完整 Node 授權套件的明文檔案快取不採用。

密碼雜湊首選 scrypt 的 N=16384、r=8、p=5、maxmem=32 MiB、輸出 32 bytes，對應 OWASP 建議配置；Workers 的 Node crypto 支援 scrypt，但仍須驗證 Sites 實際成本。[OWASP 密碼儲存](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Workers Node crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)

PBKDF2 的限制及本機覆寫差異來自 [workerd 限制程式碼](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h)與[本機執行設定](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/server.c%2B%2B)。加密、工作階段及 CSRF 分別依照 [OWASP 加密儲存](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)、[工作階段](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)與[CSRF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)設計。

權限、發布與票據判定必須讀取最新主庫狀態；使用 D1 Sessions 時明確選 `first-primary`，不能拿瀏覽快取或外來 bookmark 作授權依據。[D1 讀取一致性](https://developers.cloudflare.com/d1/best-practices/read-replication/)

## 7. 30 天紀錄與無排程清理

**決策**：所有紀錄查詢強制 `created_at >= now - 30 days`。一般請求觸發有界分批刪除過期資料；裝置碼、票據、短期工作與工作階段同樣在使用時檢查到期。過期資料即使尚未實體刪除也不得被讀取或使用。

**理由**：第一版沒有排程，不可能承諾完全無流量時在第 30 天當刻實體刪除。紀錄超過期限即不可查閱；後續流量清理實體資料。傳輸若沒有可靠的結束／失敗觀察，維持 `unknown`，不以時間推測成功或失敗。

**替代方案**：為清理加入 cron 或把 `waitUntil` 當作持久背景工作會增加已排除的服務，不採用。客戶端斷線後的背景執行期限也不能作可靠佇列。[Workers 執行期限](https://developers.cloudflare.com/workers/platform/limits/)

## 8. 已完成決策與外部能力驗證的界線

本研究已選定實作架構、授權路徑、資料與介面策略，沒有需要再向使用者重問的產品決策。下列項目不是已通過的功能，而是工作清單必須優先安排的 G0 門檻：

1. 真實 Sites 完成密碼雜湊、D1 原子競爭、秘密讀取與大型串流。
2. Microsoft 官方頁面完成裝置碼授權，跨獨立請求與冷啟動重用，完成一次真實續期及 XSTS 重建。
3. 驗證擁有者穩定 ID；以至少兩個可區辨欄位證明最新／歷史歸屬，包含非作用中欄位；排除受邀 Realm。
4. 最新及不同歷史檔案下載正確；至少一份在基岩版成功匯入，記錄內容辨識與實際最大世界大小。
5. 實測下載來源主機、重新導向、Client-Version、上游錯誤／準備狀態與 Sites 配額。

任何必要能力失敗都阻止進入完整產品實作及發布。須留下可重現證據，回到規格或方案決策，不自行改託管、不取消歷史下載、不降低欄位歸屬要求。驗收證據格式見[快速開始](quickstart.md)。
