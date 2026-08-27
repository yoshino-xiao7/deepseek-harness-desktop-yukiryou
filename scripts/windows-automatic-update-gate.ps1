param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Prepare', 'Cleanup')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$gateRoot = Join-Path $repositoryRoot 'out\windows-automatic-update-gate'
$statePath = Join-Path $gateRoot 'state.json'
$gateIdentity = if ($env:GITHUB_RUN_ID -and $env:GITHUB_RUN_ATTEMPT) {
  "$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
} else {
  'local'
}
$installRoot = Join-Path ([System.IO.Path]::GetTempPath()) "dsh-yukiryou-automatic-update-$gateIdentity"
$executable = Join-Path $installRoot 'DeepSeek YukiRyou.exe'
$uninstaller = Join-Path $installRoot 'Uninstall DeepSeek YukiRyou.exe'
$mirrorHost = '127.0.0.1'
$mirrorPort = 41337
$mirrorBasePath = '/mirrorx'
$mirrorOrigin = "http://$mirrorHost`:$mirrorPort$mirrorBasePath"

function Invoke-Checked(
  [string]$FilePath,
  [string[]]$Arguments,
  [int]$TimeoutSeconds = 600
) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not $process.WaitForExit(15000)) {
    if ((Get-Date) -ge $deadline) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "$FilePath did not exit within $TimeoutSeconds seconds"
    }
  }
  if ($process.ExitCode -ne 0) { throw "$FilePath failed with exit code $($process.ExitCode)" }
}

function Wait-Until([scriptblock]$Condition, [string]$FailureMessage) {
  $deadline = (Get-Date).AddMinutes(2)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw $FailureMessage
}

function Invoke-BoundedDownload([string]$Url, [string]$Destination) {
  Write-Output "Downloading previous release from $Url"
  Invoke-Checked (Get-Command curl.exe).Source @(
    '--fail', '--location', '--silent', '--show-error',
    '--retry', '3', '--retry-all-errors', '--connect-timeout', '20',
    '--max-time', '480', '--output', $Destination, $Url
  )
}

function Set-GateEnvironment([string]$Name, [string]$Value) {
  # The real update test runs in this same workflow step so the loopback mirror
  # cannot be reaped by the runner between Prepare and verification. Publish
  # each value both to this PowerShell process and to later cleanup steps.
  [System.Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
  "$Name=$Value" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}

function Remove-DirectoryEventually([string]$Root) {
  $deadline = (Get-Date).AddSeconds(30)
  $lastFailure = $null
  do {
    if (-not (Test-Path -LiteralPath $Root)) { return }
    try {
      Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction Stop
    } catch {
      $lastFailure = $_
      if (-not (Test-Path -LiteralPath $Root)) { return }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Could not remove stale automatic-update installation '$Root': $lastFailure"
}

function Remove-GateInstallation([string]$Root) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
  $targetExecutable = Join-Path $resolvedRoot 'DeepSeek YukiRyou.exe'
  $targetUninstaller = Join-Path $resolvedRoot 'Uninstall DeepSeek YukiRyou.exe'
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and (
        $_.ExecutablePath -eq $targetExecutable -or
        ($_.CommandLine -and $_.CommandLine.Contains(
          $resolvedRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        ))
      )
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $targetUninstaller) {
    Invoke-Checked $targetUninstaller @('/S')
    Wait-Until { -not (Test-Path -LiteralPath $targetExecutable) } 'Updater gate installation remained after uninstall'
  }
  if (Test-Path -LiteralPath $resolvedRoot) {
    # NSIS can hand deletion to a short-lived child process before the parent
    # uninstaller exits. Treat files disappearing during recursive removal as
    # progress, then retry until the exact isolated root is gone.
    Remove-DirectoryEventually $resolvedRoot
  }
}

function Remove-StaleGateInstallations {
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'dsh-yukiryou-automatic-update-*' |
    Where-Object { $_.FullName -ne $installRoot } |
    ForEach-Object {
      Write-Output "Recovering stale automatic-update installation $($_.FullName)"
      Remove-GateInstallation $_.FullName
    }
}

function Install-PreviousRelease([string]$Installer, [string]$Version) {
  $maximumAttempts = 2
  for ($attempt = 1; $attempt -le $maximumAttempts; $attempt += 1) {
    try {
      Write-Output "Installing previous public release $Version into $installRoot (attempt $attempt/$maximumAttempts)"
      Invoke-Checked $Installer @('/S', '/currentuser', "/D=$installRoot")
      Wait-Until {
        (Test-Path -LiteralPath $executable) -and
        (Test-Path -LiteralPath $uninstaller) -and
        (Test-Path -LiteralPath (Join-Path $installRoot 'resources\app.asar'))
      } 'Previous release did not install into the isolated directory'
      return
    } catch {
      if ($attempt -ge $maximumAttempts) { throw }
      Write-Warning "Previous-release installer attempt $attempt failed; cleaning the isolated directory before one retry: $($_.Exception.Message)"
      Remove-GateInstallation $installRoot
      Start-Sleep -Seconds 2
    }
  }
}

if ($Action -eq 'Cleanup') {
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.serverPid) {
      Stop-Process -Id ([int]$state.serverPid) -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-GateInstallation $installRoot
  Write-Output 'Cleaned the isolated Windows automatic-update gate'
  exit 0
}

if (-not $env:GITHUB_REPOSITORY) { throw 'GITHUB_REPOSITORY is required' }
if (-not $env:RELEASE_VERSION) { throw 'RELEASE_VERSION is required' }
if (-not $env:GITHUB_ENV) { throw 'GITHUB_ENV is required' }
Remove-StaleGateInstallations
if (Test-Path -LiteralPath $installRoot) {
  Write-Output "Recovering interrupted automatic-update installation $installRoot"
  Remove-GateInstallation $installRoot
}

New-Item -ItemType Directory -Path $gateRoot -Force | Out-Null
$assetsRoot = Join-Path $gateRoot 'assets'
$metadataRoot = Join-Path $gateRoot 'metadata'
$previousRoot = Join-Path $gateRoot 'previous'
New-Item -ItemType Directory -Path $assetsRoot, $metadataRoot, $previousRoot -Force | Out-Null
@{} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

$previousRelease = (& gh api "repos/$env:GITHUB_REPOSITORY/releases/latest") |
  ConvertFrom-Json
$previousTag = ([string]$previousRelease.tag_name).Trim()
if (-not $previousTag.StartsWith('v')) { throw "Invalid previous release tag: $previousTag" }
$previousVersion = $previousTag.Substring(1)
if ($previousVersion -eq $env:RELEASE_VERSION) { throw 'Previous and candidate versions must differ' }
$previousAsset = "DeepSeek.YukiRyou-$previousVersion-win32-x64-Setup.exe"
$previousReleaseAsset = @(
  $previousRelease.assets | Where-Object { $_.name -eq $previousAsset }
)[0]
if ($null -eq $previousReleaseAsset) {
  throw "Previous release asset is missing: $previousAsset"
}
$previousInstaller = Join-Path $previousRoot $previousAsset
$downloadSources = @(
  "https://download-cn.suzuki.ink/releases/$previousTag/$previousAsset",
  [string]$previousReleaseAsset.browser_download_url
)
$downloaded = $false
foreach ($source in $downloadSources) {
  try {
    Invoke-BoundedDownload $source $previousInstaller
    $downloaded = $true
    break
  } catch {
    Write-Warning "Previous-release download failed from $source`: $($_.Exception.Message)"
    Remove-Item -LiteralPath $previousInstaller -Force -ErrorAction SilentlyContinue
  }
}
if (-not $downloaded) { throw "Failed to download $previousAsset from all bounded sources" }

$expectedSize = [long]$previousReleaseAsset.size
$actualSize = (Get-Item -LiteralPath $previousInstaller).Length
if ($actualSize -ne $expectedSize) {
  throw "Previous release asset size mismatch: expected $expectedSize, got $actualSize"
}
$expectedDigest = [string]$previousReleaseAsset.digest
if (-not $expectedDigest.StartsWith('sha256:')) {
  throw "Previous release asset has no SHA-256 digest: $previousAsset"
}
$actualDigest = (Get-FileHash -LiteralPath $previousInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualDigest -ne $expectedDigest.Substring(7).ToLowerInvariant()) {
  throw "Previous release asset SHA-256 mismatch: $previousAsset"
}
Write-Output "Verified previous release asset $previousAsset ($actualSize bytes)"

Install-PreviousRelease $previousInstaller $previousVersion
Write-Output "Installed previous public release $previousVersion"
$installedArchive = Join-Path $installRoot 'resources\app.asar'
if (-not (Test-Path -LiteralPath $installedArchive)) {
  throw "Previous release app archive is missing: $installedArchive"
}
Write-Output "Redirecting the installed previous release to the isolated update mirror"
& node (Join-Path $PSScriptRoot 'patch-packaged-update-origin.ts') `
  "--archive=$installedArchive" '--from=https://download-cn.suzuki.ink' "--to=$mirrorOrigin"
if ($LASTEXITCODE -ne 0) { throw 'Failed to redirect the installed previous release update origin' }

$candidateSource = Join-Path $repositoryRoot 'out\windows-candidate\DeepSeek-YukiRyou-Setup.exe'
$candidateAsset = "DeepSeek.YukiRyou-$env:RELEASE_VERSION-win32-x64-Setup.exe"
if (-not (Test-Path -LiteralPath $candidateSource)) { throw "Candidate installer is missing: $candidateSource" }
Write-Output "Copying candidate installer into the isolated update mirror"
Copy-Item -LiteralPath $candidateSource -Destination (Join-Path $assetsRoot $candidateAsset)
Write-Output "Generating candidate update metadata"
& node (Join-Path $PSScriptRoot 'prepare-update-metadata.ts') `
  "--assets=$assetsRoot" "--output=$metadataRoot" "--version=$env:RELEASE_VERSION" `
  '--target=win32-x64' "--origin=$mirrorOrigin"
if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare Windows update metadata' }
Write-Output "Generated candidate update metadata"

$serverLog = Join-Path $gateRoot 'server.log'
Write-Output "Starting the isolated loopback update mirror"
$noProxy = @($env:NO_PROXY, $mirrorHost) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  Join-String -Separator ','
$env:NO_PROXY = $noProxy
$env:no_proxy = $noProxy
"NO_PROXY=$noProxy" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"no_proxy=$noProxy" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(
  (Join-Path $PSScriptRoot 'serve-automatic-update-gate.ts'),
  '--protocol=http', "--assets=$assetsRoot",
  "--metadata=$metadataRoot", '--target=win32-x64', "--version=$env:RELEASE_VERSION",
  "--port=$mirrorPort", "--base-path=$mirrorBasePath"
) -RedirectStandardOutput $serverLog `
  -RedirectStandardError (Join-Path $gateRoot 'server-error.log') -PassThru

@{
  serverPid = $server.Id
  installRoot = $installRoot
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

try {
  Wait-Until {
    if ($server.HasExited) {
      throw "The isolated loopback update mirror exited with code $($server.ExitCode)"
    }
    try {
      $health = & (Get-Command curl.exe).Source @(
        '--fail', '--silent', '--show-error', '--noproxy', '*',
        "$mirrorOrigin/health"
      )
      $LASTEXITCODE -eq 0 -and $health -eq 'ok'
    } catch { $false }
  } 'The isolated loopback update mirror did not become healthy'
} catch {
  Get-Content -LiteralPath $serverLog -ErrorAction SilentlyContinue
  Get-Content -LiteralPath (Join-Path $gateRoot 'server-error.log') -ErrorAction SilentlyContinue
  throw
}
Write-Output "The isolated loopback update mirror is healthy"

Set-GateEnvironment 'DSH_PREVIOUS_EXECUTABLE_PATH' $executable
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_RELAUNCH_PATH' $executable
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_EXPECTED_VERSION' $env:RELEASE_VERSION
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_MIRROR_METADATA_URL' "$mirrorOrigin/updates/win32-x64/latest.yml"
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_DIAGNOSTICS' (Join-Path $gateRoot 'diagnostics')
Write-Output "Prepared real Windows automatic update from $previousVersion to $env:RELEASE_VERSION"
