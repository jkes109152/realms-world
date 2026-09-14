# G0 最新存檔發布與下載實測

**日期**：2026-09-14（台灣時間）

**範圍**：依使用者最新指示，只發布及下載所選欄位的官方 latest；歷史備份不公開。

## 已通過的真實證據

- Sites 版本 7，來源 `4c713dcea61c0430dea6896805d714a88623ebb1`；環境 revision 6，外層私人且公開總開關關閉。
- 前向 ADD COLUMN 遷移後，原有 6 個欄位保留，publication_scope 均預設 latest。
- 2026-09-13 23:36:44.036 UTC，官方 latest 描述回傳精確主機 `bedrock.contentlegacy.realms.minecraft-services.net`，附專用下載 token 及已知大小；不保留原始 URL／token。此主機加入明確 allowlist，redirect 政策仍為空。
- 指定欄位 3 的發布成功，畫面顯示「已發布最新存檔，歷史備份未公開」。沒有查詢備份清單或切換作用中欄位。
- 23:38:24.846 UTC 建立 selector_kind=latest 的工作，僅一次準備即 ready，safe_error_code=null。

## 原生下載按鈕修正

首次按鈕操作後，DOM 表單消失，沒有 redeem 請求、來源傳輸或新檔案，工作仍 ready。程式在 onSubmit 同步設定 submitted，原條件因此移除表單，可能在瀏覽器原生送出前取消該表單。改為保留表單，只停用重複送出按鈕並在第二次 submit 阻止重送；不使用 Blob 或改成整檔 fetch。

本修正的型別、ESLint 及建置通過。首次按鈕操作不計為下載成功；修正後的真實結果如下。

## 最新檔案下載成功

- Sites 版本 8，來源 `3285bcb2493f3c221f1e167546b97ec1b786e17f`，環境 revision 6，於 2026-09-13 23:41:50.824 UTC 部署成功。
- 重新載入管理頁並讀取世界後，只有指定欄位 3 保持 published=1、association_status=verified、publication_scope=latest；其他 5 個欄位未發布。
- 再建立一次 latest 工作及按下原生下載後，表單保持存在；23:42:39.137 UTC 開始串流，D1 實際觀察 outcome=transfer_ended、observed_bytes=11516922，沒有失敗碼。Chrome 管理頁顯示「伺服器傳輸結束」。
- 使用者裝置下載資料夾出現 11,516,922 bytes 的 .mcworld，與伺服器觀察相等。逐項讀取 ZIP 的 16 個項目成功，含 level.dat、levelname.txt 與 db/。SHA-256 為 `8217b72f7d5d5ca6554e5f808f37f90ba685d46966ef7828305d804e26fa6694`。
- 檔案只保存在使用者裝置，網站未保存世界副本。ZIP 結構及傳輸結束不能取代基岩版匯入與最新內容確認。

## 尚未完成

基岩版匯入、最新內容確認、最大世界、非作用中欄位及完整 G0 仍待驗證。只完成一份最新下載不能完成 T027。所選欄位暫留於私人驗證範圍，等待使用者匯入確認；正式公開開關未啟用。

## 首頁最新下載實測

- Sites 版本 10，來源 `f9362b5eb5347f8eb50bfe47be084fd6378b43a5`，環境 revision 6，於 2026-09-14 15:58:44.630453 UTC 部署成功；仍為私人且 DOWNLOADS_ENABLED=false。
- 管理員從原管理頁的首頁連結進入，首頁顯示「管理員預覽」與唯一已發布的「又大又多房子世界」。一般訪客關閉狀態與確實沒有發布世界的空狀態已分開。
- 2026-09-14 15:59:14.896 UTC 從首頁建立全新的 latest 工作，prepare_attempts=1；準備後按「儲存最新 .mcworld」，原生表單保持存在且停用重複送出。
- 串流於 15:59:41.385 UTC 開始、15:59:42.344 UTC 結束；D1 outcome=transfer_ended、observed_bytes=11402793、safe_error_code=null，首頁亦顯示「伺服器傳輸結束」。
- 使用者下載資料夾新增 `又大又多房子世界-latest (1).mcworld`，11,402,793 bytes，與本次伺服器觀察一致。SHA-256 為 `f8a5e39f1a43469445e5793055e89c3f0acdb51b52c57c5f185a91f42704d1cc`；ZIP 的 14 個項目均可讀，含 level.dat、levelname.txt 與 db/。
- 此檔案大小與雜湊不同於較早的下載；配合每次新工作獨立請求官方 latest 的整合案例，證明本次並未沿用之前檔案。不能僅憑不同雜湊判定遊戲內容正確。
- 使用者本次明確回覆「尚未匯入」。遊戲匯入、最新內容確認、完整 G0 與正式匿名開放均維持待完成；受保護首頁下載成功不代表正式匿名驗收通過。
