param(
  [string]$Message = "",
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [string]$Server = "root@121.41.197.129",
  [string]$AppDir = "/root/liming-course-system",
  [string]$Domain = "https://www.limingedu.fun",
  [string]$KeyPath = "",
  [switch]$SkipCommit,
  [switch]$SkipChecks,
  [switch]$Yes,
  [switch]$NoRebase
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

function Get-AheadBehind($Remote, $Branch) {
  $aheadBehind = git rev-list --left-right --count "$Remote/$Branch...HEAD"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to compare local HEAD with $Remote/$Branch."
  }
  $parts = $aheadBehind -split "\s+"
  return @{
    Behind = [int]$parts[0]
    Ahead = [int]$parts[1]
  }
}

function Confirm-Step($Prompt) {
  if ($Yes) {
    return
  }
  $answer = Read-Host "$Prompt Type Y to continue"
  if ($answer -notin @("Y", "y", "YES", "Yes", "yes")) {
    throw "Cancelled by user."
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Require-Command git
Require-Command node

$currentBranch = git branch --show-current
if ($LASTEXITCODE -ne 0) {
  throw "Unable to determine current Git branch."
}
if ($currentBranch -ne $Branch) {
  throw "Current branch is '$currentBranch', but this script is configured to publish '$Branch'. Switch branches or pass -Branch $currentBranch intentionally."
}

$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"
if (-not (Test-Path $ssh)) {
  $sshCommand = Get-Command ssh -ErrorAction SilentlyContinue
  if (-not $sshCommand) {
    throw "Missing OpenSSH client. Install Windows OpenSSH Client or add ssh.exe to PATH."
  }
  $ssh = $sshCommand.Source
}

$defaultKeyPath = Join-Path $PSScriptRoot "黎明教育.pem"
$sshArgs = @()
if ([string]::IsNullOrWhiteSpace($KeyPath) -and (Test-Path -LiteralPath $defaultKeyPath)) {
  $KeyPath = $defaultKeyPath
}
if (-not [string]::IsNullOrWhiteSpace($KeyPath)) {
  $resolvedKeyPath = (Resolve-Path -LiteralPath $KeyPath).Path
  $sshArgs += @("-i", $resolvedKeyPath, "-o", "IdentitiesOnly=yes")
  Write-Host "Using SSH key: $resolvedKeyPath" -ForegroundColor Cyan
}

Run git @("fetch", $Remote, $Branch)

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

$syncState = Get-AheadBehind $Remote $Branch
if ($syncState.Behind -gt 0 -and $syncState.Ahead -eq 0) {
  Write-Host "Local branch is behind $Remote/$Branch. Fast-forwarding before publish." -ForegroundColor Yellow
  Confirm-Step "GitHub has $($syncState.Behind) new commit(s). Update local code from $Remote/$Branch and then publish to server?"
  Run git @("merge", "--ff-only", "$Remote/$Branch")
} elseif ($syncState.Behind -gt 0 -and $syncState.Ahead -gt 0) {
  if ($NoRebase) {
    throw "Local and remote branches have diverged. Rerun without -NoRebase, or manually rebase/merge first."
  }
  Write-Host "Local and remote branches have diverged. Rebasing local commits onto $Remote/$Branch." -ForegroundColor Yellow
  Confirm-Step "GitHub has $($syncState.Behind) new commit(s), and local has $($syncState.Ahead) unpublished commit(s). Rebase local commits onto $Remote/$Branch and then publish to server?"
  Run git @("rebase", "$Remote/$Branch")
}

if (-not $SkipChecks) {
  Run node @("--check", "public/app.js")
  Run node @("--check", "src/server.js")
  Run node @("--check", "scripts/audit_extended.js")
  Run node @("--check", "scripts/audit_source_vs_summary.js")
  Run git @("diff", "--check")
}

Run git @("push", $Remote, $Branch)

$remoteCommand = "cd $AppDir && DOMAIN=$Domain sh scripts/server-update.sh"
Write-Host "==> Updating server $Server" -ForegroundColor Cyan
Write-Host "If SSH key login is not configured, enter the server password when OpenSSH prompts." -ForegroundColor Yellow
& $ssh @sshArgs $Server $remoteCommand
if ($LASTEXITCODE -ne 0) {
  throw "Server update failed with exit code $LASTEXITCODE."
}

Write-Host "Publish and server update complete." -ForegroundColor Green
