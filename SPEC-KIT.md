# 本專案的 Spec Kit

已安裝官方 GitHub Spec Kit **v1.0.6**，使用 Codex skills 與 PowerShell 腳本。
來源：https://github.com/github/spec-kit/tree/v1.0.6

## 安裝位置

- `.tools/spec-kit/venv/`：此專案專用的 Python 虛擬環境與 Specify CLI，已加入 `.gitignore`。
- `.agents/skills/speckit-*/`：此專案的 Codex skills。
- `.specify/`：SDD 模板、工作流程、專案原則與 PowerShell 腳本。
- `specify.ps1`：本機 CLI 入口，不需啟用虛擬環境。

未進行全域工具安裝，也未變更使用者 PATH 或全域 Codex 設定。虛擬環境使用電腦既有的 Python 3.14。

## 使用

在專案目錄的 PowerShell 執行：

```powershell
.\specify.ps1 version
.\specify.ps1 --help
```

在此專案重新開啟 Codex 工作階段，讓新安裝的 skills 載入，依序使用：

1. `$speckit-constitution`：制定專案原則。
2. `$speckit-specify`：描述要開發的功能與需求。
3. `$speckit-clarify`：有重要需求疑義時釐清，已明確的決策不重複詢問。
4. `$speckit-plan`：建立技術實作計畫。
5. `$speckit-tasks`：拆解工作。
6. `$speckit-analyze`：實作前檢查規格、計畫與任務的一致性。
7. `$speckit-implement`：依任務實作。
8. `$speckit-converge`：檢查實作與規格是否一致。

需要額外需求品質檢查時可使用 `$speckit-checklist`。

## 目前 SDD 狀態（2026-09-13）

- 已完成[專案憲章 v2.0.0](.specify/memory/constitution.md)，包含繁體中文文件與 Spec Kit 分支／PR 規則。
- 目前功能：[Realms World 公開世界下載站](specs/001-realms-world-downloads/spec.md)。
- 功能目錄：`specs/001-realms-world-downloads/`。
- Git 功能分支：`001-realms-world-downloads`。
- [需求品質檢查](specs/001-realms-world-downloads/checklists/requirements.md)共 16 項通過；
  這是規格審查結果，不代表程式或 Realms 串接已完成。
- [技術規劃交接](specs/001-realms-world-downloads/planning-input.md)保存 Sites、自訂網域、
  Git、授權與下載限制等已確認的規劃輸入，不取代後續 `plan.md`。
- 已完成[技術計畫](specs/001-realms-world-downloads/plan.md)、研究、資料模型、介面契約與驗證指南。
- 已完成[任務清單](specs/001-realms-world-downloads/tasks.md)：95 項任務、5 個使用者故事、15 項可在指定批次平行執行的工作，全部尚未執行。
- 下一步為 `$speckit-analyze`，通過一致性檢查後再執行 `$speckit-implement`；尚未建立應用程式或部署網站。
- Sites／Realms 授權、續期、欄位歸屬、真實下載及遊戲匯入仍待 G0 驗證，不以文件完成代表串接可用。

`.specify/feature.json` 保存目前功能目錄，屬忽略追蹤的本機狀態。
新的 checkout 若沒有該檔案，可在執行下游命令的 PowerShell 工作階段明確設定：

```powershell
$env:SPECIFY_FEATURE_DIRECTORY = Join-Path (Get-Location) 'specs/001-realms-world-downloads'
$env:SPECIFY_FEATURE = '001-realms-world-downloads'
```

Spec Kit 功能名稱與 Git 分支名稱獨立；技術計畫的分支欄位應記錄實際 Git 分支。

## 重建本機工具環境

需先具備 uv、Git 與 Python 3.11 以上版本。以下命令固定使用本次安裝的官方提交：

```powershell
uv venv .tools/spec-kit/venv --python 3.14
uv pip install --python .tools/spec-kit/venv/Scripts/python.exe -r spec-kit-requirements.txt
.\specify.ps1 version
```

既有專案不需再次執行 init；`.specify/` 與 `.agents/skills/` 應隨專案保存。
