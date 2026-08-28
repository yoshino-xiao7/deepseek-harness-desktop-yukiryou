export type WindowsProcessScopeAction = 'list' | 'stop';

/** Build a PowerShell command that scopes processes to one installation root. */
export function createWindowsInstallDirectoryProcessScript(
  installDirectory: string,
  action: WindowsProcessScopeAction,
): string {
  const processAction = action === 'list'
    ? '$process.ProcessId'
    : 'Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue';
  return [
    `$root=${powerShellLiteral(installDirectory)}.TrimEnd('\\');`,
    '$prefix="$root\\";',
    '$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop);',
    '$scoped = @{};',
    'foreach ($process in $processes) {',
    'if ($process.ExecutablePath -and',
    '$process.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {',
    '$scoped[[string]$process.ProcessId] = $true',
    '} };',
    'do {',
    '$added = $false;',
    'foreach ($process in $processes) {',
    '$parentKey = [string]$process.ParentProcessId;',
    '$processKey = [string]$process.ProcessId;',
    'if ($scoped.ContainsKey($parentKey) -and -not $scoped.ContainsKey($processKey)) {',
    '$scoped[$processKey] = $true; $added = $true',
    '}',
    '} } while ($added);',
    'foreach ($process in $processes) {',
    `if ($scoped.ContainsKey([string]$process.ProcessId)) { ${processAction} }`,
    '}',
  ].join(' ');
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
