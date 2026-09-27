# Создаёт метку в репозитории и по желанию вешает её на issue.
# Нужен GitHub CLI (gh), авторизованный аккаунтом с правом записи.
#
#   .\scripts\add-label.ps1 -Name enhancement -Description "New feature" -Color a2eeef
#   .\scripts\add-label.ps1 -Name bug -Issue 3

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Name,

    [string]$Description = "",

    [string]$Color = "",

    [int]$Issue = 0,

    [string]$Repo = "AlexeyAbretov/orchestrator_lang"
)

$ErrorActionPreference = "Stop"
# Ненулевой код gh не должен обрывать скрипт: отсутствие метки — нормальный случай.
$PSNativeCommandUseErrorActionPreference = $false

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) не найден. Установите его: https://cli.github.com/"
}

$color = $Color.Trim().TrimStart("#")
if ($color -and $color -notmatch '^[0-9A-Fa-f]{6}$') {
    throw "Цвет должен быть HEX из 6 символов, например a2eeef."
}

$names = @(gh label list --repo $Repo --search $Name --limit 100 --json name --jq ".[].name")
if ($LASTEXITCODE -ne 0) {
    throw "Не удалось прочитать метки репозитория $Repo."
}
$exists = $names -contains $Name

$ghArgs = @("label", "create", $Name, "--repo", $Repo)
if ($Description) {
    $ghArgs += @("--description", $Description)
}
if ($color) {
    $ghArgs += @("--color", $color)
}

if (-not $exists) {
    & gh @ghArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось создать метку '$Name'."
    }
    Write-Host "Метка '$Name' создана в $Repo."
}
elseif ($Description -or $color) {
    & gh @ghArgs --force
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось обновить метку '$Name'."
    }
    Write-Host "Метка '$Name' обновлена в $Repo."
}
else {
    Write-Host "Метка '$Name' уже есть в $Repo."
}

if ($Issue -gt 0) {
    & gh issue edit $Issue --repo $Repo --add-label $Name
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось назначить метку '$Name' на issue #$Issue."
    }
    Write-Host "Метка '$Name' добавлена к issue #$Issue."
}
