param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Recover', 'Install', 'Repair', 'Uninstall')]
  [string]$Action,

  [string]$CandidateDirectory = 'out/windows-candidate',
  [string]$StatePath = 'out/windows-lifecycle/state.json'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$candidateRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $CandidateDirectory))
$stateFile = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $StatePath))
$installRoot = Join-Path $env:LOCALAPPDATA 'DeepSeekYukiRyou'
$userDataRoot = Join-Path $env:APPDATA 'DeepSeek YukiRyou'
$setupPath = Join-Path $candidateRoot 'DeepSeek-YukiRyou-Setup.exe'
$manifestPath = Join-Path $candidateRoot 'windows-candidate-manifest.json'
$executableName = 'DeepSeek YukiRyou.exe'
$shortcutName = 'DeepSeek YukiRyou.lnk'
$markerName = 'windows-lifecycle-user-data-marker.json'
$markerPath = Join-Path $userDataRoot $markerName

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Condition,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage,
    [scriptblock]$FailureDetail = $null,
    [int]$TimeoutSeconds = 60
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  $detail = if ($null -ne $FailureDetail) { & $FailureDetail } else { '' }
  throw "$FailureMessage$detail"
}

function Get-InstalledExecutable {
  $candidate = Get-ChildItem -Path $installRoot -Directory -Filter 'app-*' |
    Sort-Object -Property LastWriteTimeUtc -Descending |
    ForEach-Object { Join-Path $_.FullName $executableName } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
  return $candidate
}

function Get-ShortcutPaths {
  return @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) $shortcutName),
    (Join-Path ([Environment]::GetFolderPath('Programs')) $shortcutName)
  )
}

function Get-UnexpectedInstallEntries {
  if (-not (Test-Path -LiteralPath $installRoot)) {
    return @()
  }
  return Get-ChildItem -LiteralPath $installRoot -Recurse -Force |
    ForEach-Object {
      [System.IO.Path]::GetRelativePath($installRoot, $_.FullName).Replace('\', '/')
    } |
    Where-Object {
      $_ -notmatch '^\.dead$' -and
      $_ -notmatch '^Update\.exe$' -and
      $_ -notmatch '^app-[^/]+$' -and
      $_ -notmatch '^app-[^/]+/(squirrel\.exe|v8_context_snapshot\.bin)$'
    }
}

function Read-State {
  if (-not (Test-Path -LiteralPath $stateFile)) {
    throw "Windows lifecycle state is missing: $stateFile"
  }
  return Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
}

if ($Action -eq 'Recover') {
  if (-not (Test-Path -LiteralPath $installRoot)) {
    if (Test-Path -LiteralPath $markerPath) {
      Remove-Item -LiteralPath $markerPath -Force
    }
    Write-Output 'No stale Squirrel lifecycle installation found'
    exit 0
  }
  if (-not (Test-Path -LiteralPath $markerPath)) {
    $installedExecutable = Get-InstalledExecutable
    $shortcutPaths = @(Get-ShortcutPaths | Where-Object { Test-Path -LiteralPath $_ })
    $uninstallEntries = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      Get-ItemProperty -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq 'DeepSeek YukiRyou' }
    $unexpectedEntries = @(Get-UnexpectedInstallEntries)
    if (
      $null -ne $installedExecutable -or
      $shortcutPaths.Count -gt 0 -or
      @($uninstallEntries).Count -gt 0 -or
      $unexpectedEntries.Count -gt 0
    ) {
      throw "Refusing to remove an unmarked pre-existing Squirrel installation: $installRoot"
    }

    Remove-Item -LiteralPath $installRoot -Recurse -Force
    Write-Output 'Removed unregistered Squirrel self-cleanup tombstones'
    exit 0
  }
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Windows candidate manifest is missing: $manifestPath"
  }

  $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (
    [string]::IsNullOrWhiteSpace([string]$marker.nonce) -or
    [string]$marker.version -ne [string]$manifest.version
  ) {
    throw 'Refusing to remove a Squirrel installation without a matching lifecycle marker'
  }

  $updateExecutable = Join-Path $installRoot 'Update.exe'
  if (-not (Test-Path -LiteralPath $updateExecutable)) {
    throw "Marked Squirrel installation has no Update.exe: $updateExecutable"
  }
  $process = Start-Process -FilePath $updateExecutable -ArgumentList '--uninstall', '--silent' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Stale Squirrel uninstall failed with exit code $($process.ExitCode)"
  }

  Wait-Until -FailureMessage 'Stale installed application remained runnable after uninstall' -Condition {
    return $null -eq (Get-InstalledExecutable)
  }
  foreach ($shortcutPath in @(Get-ShortcutPaths)) {
    if (Test-Path -LiteralPath $shortcutPath) {
      throw "Stale Squirrel shortcut remained after uninstall: $shortcutPath"
    }
  }
  $script:unexpectedEntries = @(Get-UnexpectedInstallEntries)
  Wait-Until -FailureMessage 'Unexpected files remained after stale Squirrel uninstall' -FailureDetail {
    return ": $($script:unexpectedEntries -join ', ')"
  } -Condition {
    $script:unexpectedEntries = @(Get-UnexpectedInstallEntries)
    return $script:unexpectedEntries.Count -eq 0
  }

  if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
  }
  Remove-Item -LiteralPath $markerPath -Force
  Write-Output 'Recovered a stale, lifecycle-marked Squirrel test installation'
  exit 0
}

if ($Action -eq 'Install') {
  if (-not (Test-Path -LiteralPath $setupPath)) {
    throw "Windows candidate setup is missing: $setupPath"
  }
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Windows candidate manifest is missing: $manifestPath"
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "Refusing to overwrite a pre-existing Squirrel installation: $installRoot"
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.target -ne 'win32-x64') {
    throw 'Windows candidate manifest is not a supported win32-x64 manifest'
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $stateFile) -Force | Out-Null
  New-Item -ItemType Directory -Path $userDataRoot -Force | Out-Null
  $marker = [ordered]@{
    nonce = [Guid]::NewGuid().ToString('N')
    version = [string]$manifest.version
    gitCommit = [string]$manifest.gitCommit
  }
  $marker | ConvertTo-Json | Set-Content -LiteralPath $markerPath -Encoding utf8

  $process = Start-Process -FilePath $setupPath -ArgumentList '--silent' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Squirrel Setup.exe failed with exit code $($process.ExitCode)"
  }

  $script:installedExecutable = $null
  Wait-Until -FailureMessage 'Installed application did not appear before timeout' -Condition {
    $script:installedExecutable = Get-InstalledExecutable
    return $null -ne $script:installedExecutable
  }
  $shortcutPaths = Get-ShortcutPaths
  Wait-Until -FailureMessage 'Squirrel did not create a desktop or Start menu shortcut' -Condition {
    return @($shortcutPaths | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
  }

  $state = [ordered]@{
    schemaVersion = 1
    version = [string]$manifest.version
    gitCommit = [string]$manifest.gitCommit
    installRoot = $installRoot
    executable = [string]$script:installedExecutable
    updateExecutable = (Join-Path $installRoot 'Update.exe')
    markerPath = $markerPath
    markerNonce = [string]$marker.nonce
    shortcutPaths = $shortcutPaths
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding utf8
  Write-Output "InstalledExecutable=$script:installedExecutable"
  exit 0
}

$state = Read-State
if ([string]$state.installRoot -ne $installRoot) {
  throw 'Lifecycle state does not belong to the expected Squirrel installation root'
}

if ($Action -eq 'Repair') {
  if (-not (Test-Path -LiteralPath $setupPath)) {
    throw "Windows candidate setup is missing: $setupPath"
  }
  $process = Start-Process -FilePath $setupPath -ArgumentList '--silent' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Squirrel repair install failed with exit code $($process.ExitCode)"
  }
  Wait-Until -FailureMessage 'Installed executable disappeared after repair install' -Condition {
    return Test-Path -LiteralPath ([string]$state.executable)
  }
  Write-Output "InstalledExecutable=$($state.executable)"
  exit 0
}

$updateExecutable = [string]$state.updateExecutable
if (-not (Test-Path -LiteralPath $updateExecutable)) {
  throw "Squirrel Update.exe is missing: $updateExecutable"
}
$process = Start-Process -FilePath $updateExecutable -ArgumentList '--uninstall', '--silent' -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "Squirrel uninstall failed with exit code $($process.ExitCode)"
}
Wait-Until -FailureMessage 'Installed application remained runnable after uninstall' -Condition {
  return -not (Test-Path -LiteralPath ([string]$state.executable))
}
foreach ($shortcutPath in @($state.shortcutPaths)) {
  if (Test-Path -LiteralPath ([string]$shortcutPath)) {
    throw "Squirrel shortcut remained after uninstall: $shortcutPath"
  }
}
$uninstallEntries = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
  Get-ItemProperty -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq 'DeepSeek YukiRyou' }
if (@($uninstallEntries).Count -gt 0) {
  throw 'Programs and Features still contains DeepSeek YukiRyou after uninstall'
}

$script:unexpectedEntries = @(Get-UnexpectedInstallEntries)
Wait-Until -FailureMessage 'Unexpected files remained after Squirrel uninstall' -FailureDetail {
  return ": $($script:unexpectedEntries -join ', ')"
} -Condition {
  $script:unexpectedEntries = @(Get-UnexpectedInstallEntries)
  return $script:unexpectedEntries.Count -eq 0
}
if (Test-Path -LiteralPath $installRoot) {
  Write-Warning 'Squirrel left only its known self-cleanup tombstones; no product executable or package remains'
}

$markerPath = [string]$state.markerPath
if (-not (Test-Path -LiteralPath $markerPath)) {
  throw 'Application user data was removed by uninstall'
}
$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
if ([string]$marker.nonce -ne [string]$state.markerNonce) {
  throw 'Application user-data marker changed during install lifecycle'
}
Remove-Item -LiteralPath $markerPath -Force
Remove-Item -LiteralPath $stateFile -Force
Write-Output 'Squirrel install, repair, uninstall, registration, shortcut, and data-retention checks passed'
