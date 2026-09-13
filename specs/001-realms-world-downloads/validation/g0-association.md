# G0 世界列表與歸屬紀錄

**日期**：2026-09-14（Asia/Taipei）

**狀態**：T026 未完成。版本來源、服務實測、欄位／歷史歸屬分別核對，不以列表回應取代下載及內容驗證。

## 用戶端版本

使用者回報世界抓不到時，Microsoft 連線已成功，但部署環境 REALMS_CLIENT_VERSION 仍為空值，世界讀取在呼叫上游前即被拒絕。

候選值 `1.26.45` 取自 [Mojang 官方協定版本](https://github.com/Mojang/bedrock-protocol-docs/releases/tag/v1.26.45)，並與 [官方 26.44／45 更新紀錄](https://feedback.minecraft.net/hc/en-us/articles/48149564061965-Minecraft-Bedrock-Edition-26-44-45-Hotfix-Changelog) 交叉核對。這只能證明版本存在；必須以同一私人 Sites、真實既有授權的列表請求確認 Realms 接受此 Client-Version。

## 待驗證

- 受邀 Realm 的真實負面對照；目前擁有者相等檢查沒有放寬。
- 至少兩個可區辨欄位、非作用中欄位與完整歷史歸屬。
- 最新及歷史下載的精確來源主機、重新導向及檔案內容。

沒有可靠歸屬證據的欄位仍不可發布；公開下載保持關閉，不切換作用中欄位。

## 真實列表結果

Sites 版本 5（Git `c93eb8b0cf21c68abe9c745f9e2eb3eb4a0a9290`）於 2026-09-13 23:04:03 UTC 部署成功，環境 revision 5 使用 `REALMS_CLIENT_VERSION=1.26.45`。在使用者已登入的 Chrome 管理頁按「讀取世界」後，畫面呈現 6 個欄位，沒有錯誤；同一私人 Sites 的 D1 讀回為 2 個擁有者 Realm、6 個欄位，均屬目前連線世代。Realm 可用狀態分別為 available 及 unavailable；不將不可用 Realm 描述成可下載。

此結果確認上述 Client-Version 已通過真實世界與欄位列表請求，並已核對 ownerUUID 與授權擁有者相等。所有欄位的 association_status 仍為 unverifiable、published=0；尚不能證明空欄位、最新／歷史來源身分及非作用中欄位歸屬。未取得檔案，不宣稱下載或匯入成功。

## 發布問題調查

使用者回報發布按鈕停用。程式確認 projectSlots 與 verifiedBackupAssociation 尚未填入真實映射，所有非空欄位均保守拒絕，並非使用者操作錯誤。新增受同一管理員／擁有者限制的唯讀 association 檢查，先取得官方欄位與備份結構摘要；不修改 published、不產生下載描述、不切換作用中欄位。兩項新增測試先因模組不存在而失敗，再完成實作後通過，涵蓋固定端點、私人值不輸出及受邀 Realm 不查備份。真實摘要待部署後核對。


## 真實歷史結構與最新範圍修訂

Sites 版本 6 於 2026-09-13 23:16 UTC 先後讀到兩個 Realm 的 5 份及 11 份備份。每份頂層只有 backupId、lastModifiedDate、size、metadata；metadata 包含描述、名稱、seed、遊戲設定及版本，但沒有明示 slotId 或內容身分。外層為 backups 陣列，未廣告分頁。不能據此把備份分配到任何欄位。安全摘要不含原始私有值。

使用者隨後明確指定只發布最新存檔。此結果只阻止歷史能力，不阻止由 ownerUUID、Realm ID、slotId 與官方固定 latest 端點核對的最新範圍。latest-slot-v1 路由不是歷史證據。版本 7 已發布所選欄位，版本 8 已實際下載一份最新檔案，證據見 [最新下載實測](g0-downloads.md)；匯入及其他未完成項目不宣告通過。
