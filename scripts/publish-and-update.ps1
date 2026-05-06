param(
  [string]$Message = "",
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [string]$Server = "root@121.41.197.129",
  [string]$AppDir = "/root/liming-course-system",
  [string]$Domain = "https://www.limingedu.fun",
  [switch]$SkipCommit,
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"

function Run($Command, [string[]]$ArgsList) {
  Write-Host "==> $Command $($ArgsList -join ' ')" -ForegroundColor Cyan
  & $Command @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command"
  }
}

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Require-Command git
Require-Command node

$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"
if (-not (Test-Path $ssh)) {
  $sshCommand = Get-Command ssh -ErrorAction SilentlyContinue
  if (-not $sshCommand) {
    throw "Missing OpenSSH client. Install Windows OpenSSH Client or add ssh.exe to PATH."
  }
  $ssh = $sshCommand.Source
}

if (-not $SkipChecks) {
  Run node @("--check", "public/app.js")
  Run node @("--check", "src/server.js")
  Run node @("--check", "scripts/audit_extended.js")
  Run node @("--check", "scripts/audit_source_vs_summary.js")
  Run git @("diff", "--check")
}

$status = git status --short
if ($status -and -not $SkipCommit) {
  if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = Read-Host "Commit message"
  }
  if ([string]::IsNullOrWhiteSpace($Message)) {
    throw "Commit message is required when there are local changes."
  }

  Run git @("add", "--", ".")
  Run git @("commit", "-m", $Message)
} elseif ($status -and $SkipCommit) {
  throw "Working tree has local changes, but -SkipCommit was set. Commit or discard them first."
}

Run git @("fetch", $Remote, $Branch)

$aheadBehind = git rev-list --left-right --count "$Remote/$Branch...HEAD"
$parts = $aheadBehind -split "\s+"
$behind = [int]$parts[0]
if ($behind -gt 0) {
  throw "Local branch is behind $Remote/$Branch. Pull/rebase first, then rerun."
}

Run git @("push", $Remote, $Branch)

$remoteCommand = "cd $AppDir && DOMAIN=$Domain sh scripts/server-update.sh"
Write-Host "==> Updating server $Server" -ForegroundColor Cyan
Write-Host "If SSH key login is not configured, enter the server password when OpenSSH prompts." -ForegroundColor Yellow
& $ssh $Server $remoteCommand
if ($LASTEXITCODE -ne 0) {
  throw "Server update failed with exit code $LASTEXITCODE."
}

Write-Host "Publish and server update complete." -ForegroundColor Green
