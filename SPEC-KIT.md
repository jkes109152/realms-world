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
3. `$speckit-plan`：建立技術實作計畫。
4. `$speckit-tasks`：拆解工作。
5. `$speckit-implement`：依任務實作。
6. `$speckit-converge`：檢查實作與規格是否一致。

亦可使用 `$speckit-clarify`、`$speckit-analyze`、`$speckit-checklist`。
目前只完成工具初始化，專案原則仍為待填寫模板，尚未建立功能規格。

## 重建本機工具環境

需先具備 uv、Git 與 Python 3.11 以上版本。以下命令固定使用本次安裝的官方提交：

```powershell
uv venv .tools/spec-kit/venv --python 3.14
uv pip install --python .tools/spec-kit/venv/Scripts/python.exe -r spec-kit-requirements.txt
.\specify.ps1 version
```

既有專案不需再次執行 init；`.specify/` 與 `.agents/skills/` 應隨專案保存。
