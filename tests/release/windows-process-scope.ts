export type WindowsProcessScopeAction = 'list' | 'stop';

/** Build a PowerShell command that scopes processes to one installation root. */
export function createWindowsInstallDirectoryProcessScript(
  installDirectory: string,
  action: WindowsProcessScopeAction,
): string {
  const processAction = action === 'list'
    ? '$_.ProcessId'
    : 'Stop-Process -Id $_.ProcessId -Force';
  return [
    `$root=${powerShellLiteral(installDirectory)}.TrimEnd('\\');`,
    '$prefix="$root\\";',
    'Get-CimInstance Win32_Process -ErrorAction Stop |',
    'Where-Object {',
    '$_.ExecutablePath -and',
    '$_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)',
    `} | ForEach-Object { ${processAction} }`,
  ].join(' ');
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
