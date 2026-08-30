import { spawnSync } from 'node:child_process';

export type WindowsProcessScopeAction = 'list' | 'stop';

/** Stop one exact Windows process tree and fail if its root remains alive. */
export function stopWindowsProcessTree(processId: number): void {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error(`Invalid Windows process ID: ${String(processId)}`);
  }
  const result = spawnSync(
    'taskkill.exe',
    ['/pid', String(processId), '/t', '/f'],
    { encoding: 'utf8', shell: false },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 && isProcessRunning(processId)) {
    throw new Error(
      `taskkill failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
}

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

function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code !== 'ESRCH';
  }
}
