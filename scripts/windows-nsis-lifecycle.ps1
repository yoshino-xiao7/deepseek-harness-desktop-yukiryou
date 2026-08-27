param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Recover', 'Install', 'Repair', 'Uninstall')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$candidateRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\out\windows-candidate'))
$stateRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\out\windows-lifecycle'))
$statePath = Join-Path $stateRoot 'state.json'
$installRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-yukiryou-nsis-install'
$setupPath = Join-Path $candidateRoot 'DeepSeek-YukiRyou-Setup.exe'
$executable = Join-Path $installRoot 'DeepSeek YukiRyou.exe'
$uninstaller = Join-Path $installRoot 'Uninstall DeepSeek YukiRyou.exe'

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  $deadline = (Get-Date).AddMinutes(10)
  while (-not $process.WaitForExit(15000)) {
    if ((Get-Date) -ge $deadline) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "$FilePath did not exit within 10 minutes"
    }
    Write-Output "Waiting for $([System.IO.Path]::GetFileName($FilePath)) (pid $($process.Id))"
  }
  if ($process.ExitCode -ne 0) {
    throw "$FilePath failed with exit code $($process.ExitCode)"
  }
}

function Wait-Until([scriptblock]$Condition, [string]$FailureMessage) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw $FailureMessage
}

if ($Action -eq 'Recover') {
  if (Test-Path -LiteralPath $uninstaller) {
    Invoke-Checked $uninstaller @('/S')
    Wait-Until { -not (Test-Path -LiteralPath $executable) } 'Stale NSIS installation remained after recovery'
  }
  if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $stateRoot) {
    Remove-Item -LiteralPath $stateRoot -Recurse -Force
  }
  Write-Output 'Recovered the isolated NSIS lifecycle directory'
  exit 0
}

if ($Action -eq 'Install') {
  if (-not (Test-Path -LiteralPath $setupPath)) { throw "Installer is missing: $setupPath" }
  if (Test-Path -LiteralPath $installRoot) { throw "Refusing to overwrite lifecycle directory: $installRoot" }
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  $maximumAttempts = 2
  for ($attempt = 1; $attempt -le $maximumAttempts; $attempt += 1) {
    try {
      Invoke-Checked $setupPath @('/S', '/currentuser', "/D=$installRoot")
      Wait-Until { (Test-Path -LiteralPath $executable) -and (Test-Path -LiteralPath $uninstaller) } 'NSIS did not install the executable and uninstaller'
      break
    } catch {
      $isTransientAccessViolation = $_.Exception.Message.Contains('exit code -1073741819')
      if (-not $isTransientAccessViolation -or $attempt -ge $maximumAttempts) { throw }
      Write-Warning "NSIS candidate installer hit transient access violation; cleaning the isolated directory before one retry"
      if (Test-Path -LiteralPath $installRoot) {
        Remove-Item -LiteralPath $installRoot -Recurse -Force
      }
      Start-Sleep -Seconds 2
    }
  }
  @{ executable = $executable; installRoot = $installRoot; uninstaller = $uninstaller } |
    ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
  Write-Output 'Installed the NSIS candidate into the explicit lifecycle directory'
  exit 0
}

if (-not (Test-Path -LiteralPath $statePath)) { throw 'NSIS lifecycle state is missing' }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ([string]$state.installRoot -ne $installRoot) { throw 'Lifecycle state points outside the isolated install directory' }

if ($Action -eq 'Repair') {
  Invoke-Checked $setupPath @('/S', '/currentuser', "/D=$installRoot")
  Wait-Until { Test-Path -LiteralPath $executable } 'NSIS repair did not preserve the executable'
  Write-Output 'NSIS same-version repair completed'
  exit 0
}

Invoke-Checked $uninstaller @('/S')
Wait-Until { -not (Test-Path -LiteralPath $executable) } 'NSIS uninstall left the product executable behind'
Write-Output 'NSIS install, repair, and uninstall checks passed'
