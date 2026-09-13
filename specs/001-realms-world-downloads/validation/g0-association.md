# G0 世界列表與歸屬紀錄

**日期**：2026-09-14（Asia/Taipei）

**狀態**：T026 未完成。版本來源、服務實測、欄位／歷史歸屬分別核對，不以列表回應取代下載及內容驗證。

## 用戶端版本

使用者回報世界抓不到時，Microsoft 連線已成功，但部署環境 REALMS_CLIENT_VERSION 仍為空值，世界讀取在呼叫上游前即被拒絕。

候選值 `1.26.45` 取自 [Mojang 官方協定版本](https://github.com/Mojang/bedrock-protocol-docs/releases/tag/v1.26.45)，並與 [官方 26.44／45 更新紀錄](https://feedback.minecraft.net/hc/en-us/articles/48149564061965-Minecraft-Bedrock-Edition-26-44-45-Hotfix-Changelog) 交叉核對。這只能證明版本存在；必須以同一私人 Sites、真實既有授權的列表請求確認 Realms 接受此 Client-Version。

## 待驗證

- 擁有者世界與欄位列表的實際回應、排除受邀 Realm。
- 至少兩個可區辨欄位、非作用中欄位與完整歷史歸屬。
- 最新及歷史下載的精確來源主機、重新導向及檔案內容。

沒有可靠歸屬證據的欄位仍不可發布；公開下載保持關閉，不切換作用中欄位。
