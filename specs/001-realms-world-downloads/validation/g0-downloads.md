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
