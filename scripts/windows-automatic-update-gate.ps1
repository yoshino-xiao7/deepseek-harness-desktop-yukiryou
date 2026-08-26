param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Prepare', 'Cleanup')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$gateRoot = Join-Path $repositoryRoot 'out\windows-automatic-update-gate'
$statePath = Join-Path $gateRoot 'state.json'
$installRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-yukiryou-automatic-update'
$executable = Join-Path $installRoot 'DeepSeek YukiRyou.exe'
$uninstaller = Join-Path $installRoot 'Uninstall DeepSeek YukiRyou.exe'
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$mirrorHost = 'download-cn.suzuki.ink'

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  $deadline = (Get-Date).AddMinutes(10)
  while (-not $process.WaitForExit(15000)) {
    if ((Get-Date) -ge $deadline) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "$FilePath did not exit within 10 minutes"
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

function Remove-GateInstallation {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $executable } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $uninstaller) {
    Invoke-Checked $uninstaller @('/S')
    Wait-Until { -not (Test-Path -LiteralPath $executable) } 'Updater gate installation remained after uninstall'
  }
}

if ($Action -eq 'Cleanup') {
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.serverPid) {
      Stop-Process -Id ([int]$state.serverPid) -Force -ErrorAction SilentlyContinue
    }
    if ($state.certificateThumbprint) {
      $certificatePath = "Cert:\CurrentUser\Root\$($state.certificateThumbprint)"
      if (Test-Path -LiteralPath $certificatePath) {
        Remove-Item -LiteralPath $certificatePath -Force
      }
    }
    if ($state.hostsBackup -and (Test-Path -LiteralPath $state.hostsBackup)) {
      Copy-Item -LiteralPath $state.hostsBackup -Destination $hostsPath -Force
    }
  }
  Remove-GateInstallation
  Write-Output 'Cleaned the isolated Windows automatic-update gate'
  exit 0
}

if (-not $env:GITHUB_REPOSITORY) { throw 'GITHUB_REPOSITORY is required' }
if (-not $env:RELEASE_VERSION) { throw 'RELEASE_VERSION is required' }
if (-not $env:GITHUB_ENV) { throw 'GITHUB_ENV is required' }
if (Test-Path -LiteralPath $installRoot) {
  throw "Refusing to overwrite the automatic-update install directory: $installRoot"
}

New-Item -ItemType Directory -Path $gateRoot -Force | Out-Null
$assetsRoot = Join-Path $gateRoot 'assets'
$metadataRoot = Join-Path $gateRoot 'metadata'
$previousRoot = Join-Path $gateRoot 'previous'
New-Item -ItemType Directory -Path $assetsRoot, $metadataRoot, $previousRoot -Force | Out-Null
@{} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

$previousTag = (& gh api "repos/$env:GITHUB_REPOSITORY/releases/latest" --jq .tag_name).Trim()
if (-not $previousTag.StartsWith('v')) { throw "Invalid previous release tag: $previousTag" }
$previousVersion = $previousTag.Substring(1)
if ($previousVersion -eq $env:RELEASE_VERSION) { throw 'Previous and candidate versions must differ' }
$previousAsset = "DeepSeek.YukiRyou-$previousVersion-win32-x64-Setup.exe"
& gh release download $previousTag --repo $env:GITHUB_REPOSITORY --pattern $previousAsset --dir $previousRoot
if ($LASTEXITCODE -ne 0) { throw "Failed to download $previousAsset" }

Invoke-Checked (Join-Path $previousRoot $previousAsset) @('/S', '/currentuser', "/D=$installRoot")
Wait-Until { (Test-Path -LiteralPath $executable) -and (Test-Path -LiteralPath $uninstaller) } 'Previous release did not install into the isolated directory'

$candidateSource = Join-Path $repositoryRoot 'out\windows-candidate\DeepSeek-YukiRyou-Setup.exe'
$candidateAsset = "DeepSeek.YukiRyou-$env:RELEASE_VERSION-win32-x64-Setup.exe"
if (-not (Test-Path -LiteralPath $candidateSource)) { throw "Candidate installer is missing: $candidateSource" }
Copy-Item -LiteralPath $candidateSource -Destination (Join-Path $assetsRoot $candidateAsset)
& node (Join-Path $PSScriptRoot 'prepare-update-metadata.ts') `
  "--assets=$assetsRoot" "--output=$metadataRoot" "--version=$env:RELEASE_VERSION" `
  '--target=win32-x64' "--origin=https://$mirrorHost"
if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare Windows update metadata' }

$certificatePath = Join-Path $gateRoot 'server.crt'
$keyPath = Join-Path $gateRoot 'server.key'
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
try {
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    'CN=DeepSeek YukiRyou update gate',
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $subjectAlternativeName =
    [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $subjectAlternativeName.AddDnsName($mirrorHost)
  $request.CertificateExtensions.Add($subjectAlternativeName.Build())
  $serverAuthentication = [System.Security.Cryptography.OidCollection]::new()
  [void]$serverAuthentication.Add(
    [System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')
  )
  $request.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new(
      $serverAuthentication,
      $false
    )
  )
  $generatedCertificate = $request.CreateSelfSigned(
    [System.DateTimeOffset]::UtcNow.AddMinutes(-5),
    [System.DateTimeOffset]::UtcNow.AddDays(1)
  )
  try {
    [System.IO.File]::WriteAllText(
      $certificatePath,
      $generatedCertificate.ExportCertificatePem(),
      [System.Text.Encoding]::ASCII
    )
    [System.IO.File]::WriteAllText(
      $keyPath,
      $rsa.ExportPkcs8PrivateKeyPem(),
      [System.Text.Encoding]::ASCII
    )
  } finally {
    $generatedCertificate.Dispose()
  }
} finally {
  $rsa.Dispose()
}
$trustedCertificate = Import-Certificate `
  -FilePath $certificatePath `
  -CertStoreLocation 'Cert:\CurrentUser\Root'
@{ certificateThumbprint = $trustedCertificate.Thumbprint } |
  ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

$hostsBackup = Join-Path $gateRoot 'hosts.before'
Copy-Item -LiteralPath $hostsPath -Destination $hostsBackup
@{
  certificateThumbprint = $trustedCertificate.Thumbprint
  hostsBackup = $hostsBackup
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Add-Content -LiteralPath $hostsPath -Value "`r`n127.0.0.1 $mirrorHost # DeepSeek YukiRyou automatic-update gate"

$serverLog = Join-Path $gateRoot 'server.log'
$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(
  (Join-Path $PSScriptRoot 'serve-automatic-update-gate.ts'),
  "--cert=$certificatePath", "--key=$keyPath", "--assets=$assetsRoot",
  "--metadata=$metadataRoot", '--target=win32-x64', "--version=$env:RELEASE_VERSION", '--port=443'
) -RedirectStandardOutput $serverLog -RedirectStandardError (Join-Path $gateRoot 'server-error.log') -PassThru

@{
  serverPid = $server.Id
  certificateThumbprint = $trustedCertificate.Thumbprint
  hostsBackup = $hostsBackup
  installRoot = $installRoot
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

Wait-Until {
  try {
    (Invoke-WebRequest -Uri "https://$mirrorHost/health" -UseBasicParsing -TimeoutSec 5).Content -eq 'ok'
  } catch { $false }
} 'The isolated HTTPS update mirror did not become healthy'

"DSH_PREVIOUS_EXECUTABLE_PATH=$executable" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"DSH_AUTOMATIC_UPDATE_RELAUNCH_PATH=$executable" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
"DSH_AUTOMATIC_UPDATE_EXPECTED_VERSION=$env:RELEASE_VERSION" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
Write-Output "Prepared real Windows automatic update from $previousVersion to $env:RELEASE_VERSION"
