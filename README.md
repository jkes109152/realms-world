# Realms World

Minecraft 基岩版 Realms 世界下載與管理，使用 Sites、Workers 與 D1。所有 SDD 文件使用繁體中文。

目前已完成最小管理員驗證入口及共用安全核心（T001～T023），正在進入 G0 真實能力驗證。公開下載保持關閉；完整產品功能與正式網域尚未交付。

## 本機開發

使用 Node 22.13.0 以上及 npm，依鎖定檔安裝：

```powershell
npm ci
npm run build
npm run db:migrate:local
npm run dev
```

複製 `.env.example` 的鍵名至被忽略的 `.dev.vars`，自行產生本機測試秘密。不要放入真實世界或 Microsoft token。`AUTH_KEYRING` 採單引號包住 JSON，例如 `AUTH_KEYRING='{"local":"自行產生的32位元組Base64金鑰"}'`，`AUTH_ACTIVE_KEY_ID` 與其鍵名一致。本機 `SITE_ORIGIN` 必須等於開發伺服器實際輸出網址。

沒有真實協定證據前，Client-Version 與下載主機保持空值，不能以猜測值開放下載。管理員驗證入口為 `/admin/verification`。

本工作區的 npm 12.0.2 放在被忽略的 `.tools/npm-runtime/package/bin/npm-cli.js`；可用 `node .tools/npm-runtime/package/bin/npm-cli.js run check` 等方式執行，不需要修改全域 npm。

## 驗證

```powershell
npm run check
npm run lint
npm run test:unit
npm run test:integration
npm run build
```

預設測試拒絕真實外部請求，使用人工 Realm、可控時間及即時產生的串流。`test:e2e` 目前只有設定；大型串流與真實 Sites／Realms 驗收仍待後續 G0 任務，不能把入口存在當作通過。

## 管理員初始化

透過 Sites 暫時部署一次性 `MAINTENANCE_TOKEN` 後，在互動終端執行：

```powershell
npm run admin:maintain -- --action bootstrap
```

密碼只接受不回顯的互動輸入，不接受命令列、環境變數或檔案。私人 Sites 的執行程序可預先取得 `REALMS_MAINTENANCE_ORIGIN`、`REALMS_MAINTENANCE_TOKEN` 與 `REALMS_SITES_ACCESS_TOKEN`；後兩者使用後即移除程序環境值，不要寫入 Git 或終端紀錄。初始化成功後移除 Sites 的維護秘密並重新部署。重設使用 `--action reset`，先確認目前帳號版本；結果不明不自動重送。

## 規格與進度

- [功能規格](specs/001-realms-world-downloads/spec.md)
- [計畫與 G0 門檻](specs/001-realms-world-downloads/plan.md)
- [95 項任務及目前進度](specs/001-realms-world-downloads/tasks.md)
- [本機核心驗證](specs/001-realms-world-downloads/validation/core.md)
- [操作與驗收指南](specs/001-realms-world-downloads/quickstart.md)

功能分支採 `001-realms-world-downloads`。沿用草稿 PR #1，真實驗收及必要檢查通過後才合併；確認實際合併之後才清除分支。世界檔、下載來源 URL、token 與本機工具均不得提交。
