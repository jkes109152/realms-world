# Microsoft／Realms 轉接器契約

**日期**：2026-09-13

**依據**：[研究](../research.md)、[資料模型](../data-model.md)

**狀態**：待 G0 證明上游相容；介面設計不等於端點已可用。

## 邊界

轉接器只在 Worker 後端執行；不直接耦合 React，不自行落盤、寫公開日誌或永久保存世界。HTTP 與加密依賴可替換為測試實作。持久授權由加密儲存層及條件更新管理，不能由套件快取略過。

以下為概念 TypeScript 簽名，實作時可拆模組，但不可減少安全條件：

```ts
beginDeviceLogin(context: AdminContext): Promise<DeviceChallenge>
advanceDeviceLoginOnce(attempt: EncryptedAttempt): Promise<AuthStepResult>
getValidRealmsAuthorization(context: ConnectionContext): Promise<AuthResult>
listOwnedRealms(auth: RealmsAuthorization): Promise<OwnedRealm[]>
listWorldSlots(auth: RealmsAuthorization, realm: VerifiedRealm): Promise<WorldSlot[]>
listBackupsForVerifiedSlot(auth: RealmsAuthorization, slot: VerifiedSlot): Promise<ArchiveList>
prepareWorldDownload(auth: RealmsAuthorization, slot: VerifiedSlot, selection: Selection): Promise<PrepareResult>
openValidatedDownload(descriptor: DownloadDescriptor, signal: AbortSignal): Promise<ValidatedStream>
```

Result 型別採可辨識聯集：ready、pending、denied、expired、reauth_required、unavailable、incompatible。回應 pending 含 nextPollAt；不可用含安全代碼、可重試性與可選 Retry-After。上游原始 body、URL、cookie、token 不能被一般 HTTP API 直接序列化。

## 授權

初始相容路徑固定為 prismarine-auth 的 live／Nintendo title，client ID、scope、relying party 與固定參考提交見[研究](../research.md)。這是需實測的相容路徑，不是第三方網站正式 SDK 保證。若服務拒絕此流程，停止並記錄，不能偽造通過或靜默改用另一個 application。

裝置碼開始呼叫 Microsoft `https://login.live.com/oauth20_connect.srf`；輪詢／刷新使用 `https://login.live.com/oauth20_token.srf` 與協定指定參數。verificationUri 必須是已確認的 Microsoft 官方 HTTPS 主機；不得讓未驗證 URL 變成管理員登入連結。

每次網站 step 僅執行一段必要外部交換，保存加密中間狀態；待授權、降速、拒絕、過期可跨請求恢復。expires_in 以秒換算，不直接加到毫秒時間戳。Xbox 使用 P-256、ES256／P1363 及參考實作的 Windows epoch 簽章封裝；同一授權世代保留必要的證明金鑰。

Realms 只使用 relying party `https://pocket.realms.minecraft.net/` 的 XSTS，請求標頭 `Authorization: XBL3.0 x={userHash};{XSTSToken}`。上游 HTTP 最長 10 秒；刷新租約 30 秒並按階段條件續租。不得在 Worker 內等待使用者完成登入，也不得把 `waitUntil` 作持久登入程序。

## Realm 與存檔歸屬

| 方法 | 上游路徑 | 必要驗證 |
|---|---|---|
| listOwnedRealms | GET /worlds | 核對穩定擁有者 ID；不可用顯示名稱或 member 旗標代替 |
| listWorldSlots | GET /worlds/{realmId} | 核對 Realm 擁有者、欄位 ID、options 結構、空欄位／內容變更 |
| listBackupsForVerifiedSlot | GET /worlds/{realmId}/backups | 回應實際沒有 slot 查詢參數，必須另有可靠歸屬證據 |
| prepareWorldDownload | GET /archive/download/world/{realmId}/{slotId}/latest | 最新選擇器；不能宣稱即時未儲存狀態 |
| prepareWorldDownload | GET /archive/download/world/{realmId}/{slotId}/{backupId} | 指定歷史需存在於目前欄位的已核對清單，不替換版本 |

每次請求設定由 G0 確認的 `REALMS_CLIENT_VERSION`，不以 `0.0.0` 當可用保證。正常版不送 is-prerelease。端點 ID 逐段編碼且長度受限，不能拼接成任意路徑或主機。

VerifiedSlot 必須攜帶來源歸屬證據及 fetchedAt。G0 實測紀錄明列真正回應欄位／規則；若只能拿到 Realm 級列表而無法可靠區分欄位，就回 incompatible(slot_unverifiable)，阻止發布。不能把整份歷史列表附上傳入 slotId 就聲稱已驗證，也不能切換作用中欄位來取得列表。

歷史分頁必須完整遍歷、去重，按已提供的時間由新到舊排序；時間缺失者排在末尾並明示未知，不能杜撰排序時間。受邀 Realm、空欄位、歸屬不明、官方已移除版本分別提供安全管理原因。

## 下載準備與來源檢查

PrepareResult 為 pending(nextPollAt) 或 ready(descriptor)。descriptor 含上游 URL、必要的獨立下載 Bearer token、可選大小／到期與已核對欄位／存檔。它不是公開 API 資料，不回傳瀏覽器。

準備回應 429／5xx 遵守 Retry-After；不能無限重試。歷史 404 在仍公開且歸屬已核對時映射 archive_gone；最新不可用不替換為其他欄位。401／403 先依協定判斷是否需續期，最多一次受協調續期後重試同一請求，仍失敗則停止。

來源 URL 只能由可信 Realms 回應提供，並符合 G0 證實的精確 HTTPS 主機清單。拒絕 IP literal、私有位址、userinfo、非標準埠及未確認主機；不接受泛用 `*.blob.core.windows.net` 或任意 CDN 通配。所有 redirect 使用 manual，每跳重驗，最多 3 次。跨主機不自動轉送授權；只有已驗證的主機對與標頭政策可重建必要的 Bearer 標頭。

抓檔案僅建立最小必要 headers，不帶本站 Cookie 或 Realms XSTS。檢查來源狀態、媒體型別及有界檔案前綴；後續 body 持續串流。取消時取消 reader 與上游 fetch；不 clone／tee 未消費大檔。來源未知大小仍可使用串流。

## G0 證據與契約測試

實作測試至少覆蓋 token 秒／毫秒、簽章固定向量、裝置碼降速、跨請求保存、刷新互斥、解除後晚到回寫、兩欄位歸屬、完整分頁、非作用中欄位、改 ID、存檔消失、來源 redirect／秘密隔離及無效檔案。

真實 Sites 驗證必須另外記錄穩定擁有者 ID 核對方法、已確認的欄位歷史映射規則、Client-Version、精確下載主機與 redirect、一次真實續期、最新及不同歷史下載、最大世界大小及至少一次基岩版匯入。原始 token／私人回應不可進測試 fixture 或 Git。
