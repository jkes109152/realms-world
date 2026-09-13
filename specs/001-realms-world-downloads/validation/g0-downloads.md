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

本修正的型別、ESLint 及建置通過；待下一個部署實測真正 redeem、傳輸與檔案。首次按鈕操作不計為下載成功。

## 尚未完成

實際檔案抵達、ZIP 內容核對、基岩版匯入、最大世界、非作用中欄位及完整 G0 仍待驗證。只完成發布或 ready 不能完成 T027。所選欄位暫留於私人驗證範圍，以接續本次下載與使用者匯入；正式公開開關未啟用。
