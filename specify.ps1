# Run the project-local Spec Kit CLI without changing PATH or activating a venv.
$specifyExe = Join-Path $PSScriptRoot '.tools/spec-kit/venv/Scripts/specify.exe'
if (-not (Test-Path -LiteralPath $specifyExe)) {
    throw 'Project-local Spec Kit is missing. See SPEC-KIT.md for installation instructions.'
}
Push-Location -LiteralPath $PSScriptRoot
try {
    & $specifyExe @args
    $specifyExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $specifyExitCode
