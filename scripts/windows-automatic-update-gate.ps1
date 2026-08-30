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
# Keep the update-gate install root on the same short temp volume used by the
# independently exercised NSIS lifecycle gate. Installing the same candidate
# directly under LOCALAPPDATA can make the assisted installer terminate with
# 0xC0000005 before the updater/relaunch assertions can run.
$installParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$installRoot = Join-Path $installParent "dsh-au-$gateIdentity"
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
        ($_.CommandLine -and $_.CommandLine.IndexOf(
          $resolvedRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -ge 0)
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
  $legacyInstallParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $staleInstallations = @(
    Get-ChildItem -LiteralPath $installParent -Directory -Filter 'dsh-au-*'
    # Recover runs created before the short-path gate was introduced. These
    # installations share the product's HKCU NSIS registration and can affect
    # a new rehearsal even though they live under the old Temp prefix.
    Get-ChildItem -LiteralPath $legacyInstallParent -Directory `
      -Filter 'dsh-yukiryou-automatic-update-*'
  ) | Sort-Object -Property FullName -Unique
  $staleInstallations |
    Where-Object { $_.FullName -ne $installRoot } |
    ForEach-Object {
      Write-Output "Recovering stale automatic-update installation $($_.FullName)"
      Remove-GateInstallation $_.FullName
    }
}

function Install-CandidateUnderTest([string]$Installer, [string]$Version) {
  $maximumAttempts = 2
  for ($attempt = 1; $attempt -le $maximumAttempts; $attempt += 1) {
    try {
      Write-Output "Installing release candidate $Version into $installRoot (attempt $attempt/$maximumAttempts)"
      Invoke-Checked $Installer @('/S', '/currentuser', "/D=$installRoot")
      Wait-Until {
        (Test-Path -LiteralPath $executable) -and
        (Test-Path -LiteralPath $uninstaller) -and
        (Test-Path -LiteralPath (Join-Path $installRoot 'resources\app.asar'))
      } 'Release candidate did not install into the isolated directory'
      return
    } catch {
      if ($attempt -ge $maximumAttempts) { throw }
      Write-Warning "Release-candidate installer attempt $attempt failed; cleaning the isolated directory before one retry: $($_.Exception.Message)"
      Remove-GateInstallation $installRoot
      Start-Sleep -Seconds 2
    }
  }
}

function Get-SyntheticSuccessorVersion([string]$Version) {
  $match = [System.Text.RegularExpressions.Regex]::Match(
    $Version,
    '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$'
  )
  if (-not $match.Success) {
    throw "Release version must be an exact three-part semantic version: $Version"
  }
  $major = [int]$match.Groups['major'].Value
  $minor = [int]$match.Groups['minor'].Value
  $patch = [int]$match.Groups['patch'].Value + 1
  return "$major.$minor.$patch"
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
$syntheticBuildRoot = Join-Path $gateRoot 'synthetic-successor'
$syntheticPrepackaged = Join-Path $gateRoot 'synthetic-prepackaged'
New-Item -ItemType Directory -Path $assetsRoot, $metadataRoot, $syntheticBuildRoot -Force | Out-Null
@{} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

$candidateSource = Join-Path $repositoryRoot 'out\windows-candidate\DeepSeek-YukiRyou-Setup.exe'
if (-not (Test-Path -LiteralPath $candidateSource)) { throw "Candidate installer is missing: $candidateSource" }
$syntheticSuccessorVersion = Get-SyntheticSuccessorVersion $env:RELEASE_VERSION
Install-CandidateUnderTest $candidateSource $env:RELEASE_VERSION
Write-Output "Installed release candidate $env:RELEASE_VERSION"
$installedArchive = Join-Path $installRoot 'resources\app.asar'
if (-not (Test-Path -LiteralPath $installedArchive)) {
  throw "Release candidate app archive is missing: $installedArchive"
}
Write-Output "Redirecting the installed release candidate to the isolated update mirror"
& node (Join-Path $PSScriptRoot 'patch-packaged-update-origin.ts') `
  "--archive=$installedArchive" '--from=https://download-cn.suzuki.ink' "--to=$mirrorOrigin"
if ($LASTEXITCODE -ne 0) { throw 'Failed to redirect the installed release candidate update origin' }

$syntheticSuccessorAsset = "DeepSeek.YukiRyou-$syntheticSuccessorVersion-win32-x64-Setup.exe"
$prepackagedCandidate = Join-Path $repositoryRoot 'out\DeepSeek YukiRyou-win32-x64'
if (-not (Test-Path -LiteralPath $prepackagedCandidate)) {
  throw "Prepackaged candidate is missing: $prepackagedCandidate"
}
Write-Output "Preparing a successor application whose packaged version is $syntheticSuccessorVersion"
Copy-Item -LiteralPath $prepackagedCandidate -Destination $syntheticPrepackaged -Recurse -Force
$syntheticArchive = Join-Path $syntheticPrepackaged 'resources\app.asar'
& node (Join-Path $PSScriptRoot 'patch-packaged-update-origin.ts') `
  "--archive=$syntheticArchive" "--version=$syntheticSuccessorVersion"
if ($LASTEXITCODE -ne 0) { throw 'Failed to stamp the synthetic successor application version' }
Write-Output "Building a real synthetic successor installer with embedded version $syntheticSuccessorVersion"
& (Get-Command pnpm.cmd).Source exec electron-builder --win nsis --x64 `
  "--prepackaged=$syntheticPrepackaged" --publish never `
  "-c.extraMetadata.version=$syntheticSuccessorVersion" `
  "-c.directories.output=$syntheticBuildRoot" `
  "-c.artifactName=$syntheticSuccessorAsset"
if ($LASTEXITCODE -ne 0) { throw 'Failed to build the synthetic successor installer' }
$syntheticSuccessorInstaller = Join-Path $syntheticBuildRoot $syntheticSuccessorAsset
if (-not (Test-Path -LiteralPath $syntheticSuccessorInstaller)) {
  throw "Synthetic successor installer is missing: $syntheticSuccessorInstaller"
}
$embeddedSuccessorVersion = (Get-Item -LiteralPath $syntheticSuccessorInstaller).VersionInfo.ProductVersion
if (-not $embeddedSuccessorVersion.StartsWith($syntheticSuccessorVersion)) {
  throw "Synthetic successor embeds version '$embeddedSuccessorVersion', expected '$syntheticSuccessorVersion'"
}
Copy-Item -LiteralPath $syntheticSuccessorInstaller -Destination (Join-Path $assetsRoot $syntheticSuccessorAsset)
Write-Output "Generating synthetic successor update metadata"
& node (Join-Path $PSScriptRoot 'prepare-update-metadata.ts') `
  "--assets=$assetsRoot" "--output=$metadataRoot" "--version=$syntheticSuccessorVersion" `
  '--target=win32-x64' "--origin=$mirrorOrigin"
if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare Windows update metadata' }
Write-Output "Generated synthetic successor update metadata"

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
  "--metadata=$metadataRoot", '--target=win32-x64', "--version=$syntheticSuccessorVersion",
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

Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_SOURCE_EXECUTABLE_PATH' $executable
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_RELAUNCH_PATH' $executable
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_EXPECTED_VERSION' $syntheticSuccessorVersion
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_INSTALLED_VERSION' $syntheticSuccessorVersion
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_MIRROR_METADATA_URL' "$mirrorOrigin/updates/win32-x64/latest.yml"
Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_DIAGNOSTICS' (Join-Path $gateRoot 'diagnostics')
Write-Output "Prepared release candidate $env:RELEASE_VERSION automatic-update rehearsal against synthetic successor $syntheticSuccessorVersion"
