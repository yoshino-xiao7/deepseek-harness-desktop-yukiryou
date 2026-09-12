const macGates = [
  'Quality and version gate',
  'Sign and build candidate',
  'Previous public macOS update compatibility gate',
  'Fresh-runner install, upgrade, and smoke gate',
  'Thirty-minute installed candidate soak',
  'Notarize the exact verified candidate',
  'Fresh-runner final DMG and ZIP gate',
];

const windowsSteps = [
  'Assemble and verify the host-native Runtime',
  'Run integration tests against the verified Runtime',
  'Build unsigned installer and portable candidates',
  'Verify updater bootstrap in packaged Windows application',
  'Start and restart the exact packaged application',
  'Start and restart the exact portable ZIP application',
  'Validate and freeze NSIS artifacts',
  'Verify candidate provenance',
  'Prepare and verify the release candidate automatic update',
  'Clean the isolated automatic-update gate',
  'Install the frozen guided NSIS candidate',
  'Start the installed application',
  'Repair-install the same candidate and restart it',
  'Uninstall and verify shortcuts and user-data retention',
];

export function validateReleaseRecoverySources(
  repository: string,
  mac: { run: unknown; jobs: unknown[] },
  windows: { run: unknown; jobs: unknown[] },
): string {
  const macRun = validateRun(repository, mac.run);
  const windowsRun = validateRun(repository, windows.run);
  if (macRun.path !== '.github/workflows/release-macos.yml') {
    throw new Error('macOS source must be the official release workflow');
  }
  if (!['.github/workflows/release-macos.yml', '.github/workflows/windows-candidate.yml'].includes(String(windowsRun.path))) {
    throw new Error('Windows source must be a trusted release or candidate workflow');
  }
  if (windowsRun.path === '.github/workflows/windows-candidate.yml' && windowsRun.conclusion !== 'success') {
    throw new Error('Independent Windows source must have succeeded');
  }
  if (macRun.head_sha !== windowsRun.head_sha) {
    throw new Error('Recovery sources must target the same immutable commit');
  }
  for (const name of macGates) requireSuccessfulJob(mac.jobs, name);
  const quality = requireSuccessfulJob(windows.jobs, 'Windows quality gate');
  for (const name of ['Run pnpm lint', 'Run pnpm typecheck', 'Run pnpm test']) requireSuccessfulStep(quality, name);
  const build = requireSuccessfulJob(windows.jobs, 'Vendor Runtime, make EXE + portable ZIP, and smoke');
  for (const name of windowsSteps) requireSuccessfulStep(build, name);
  return String(macRun.head_sha);
}

function validateRun(repository: string, value: unknown): Record<string, unknown> {
  const run = record(value);
  if (record(run.repository).full_name !== repository || record(run.head_repository).full_name !== repository ||
      run.head_branch !== 'main' || run.event !== 'workflow_dispatch' || run.status !== 'completed' ||
      typeof run.head_sha !== 'string' || !/^[0-9a-f]{40}$/.test(run.head_sha)) {
    throw new Error('Recovery requires a completed main-branch dispatch in this repository');
  }
  return run;
}

function requireSuccessfulJob(jobs: unknown[], name: string): Record<string, unknown> {
  const matches = jobs.map(record).filter(job => job.name === name ||
    (typeof job.name === 'string' && job.name.endsWith(` / ${name}`)));
  if (matches.length !== 1 || matches[0]!.conclusion !== 'success') {
    throw new Error(`Required recovery gate did not succeed: ${name}`);
  }
  return matches[0]!;
}

function requireSuccessfulStep(job: Record<string, unknown>, name: string): void {
  const matches = Array.isArray(job.steps) ? job.steps.map(record).filter(step => step.name === name) : [];
  if (matches.length !== 1 || matches[0]!.conclusion !== 'success') {
    throw new Error(`Required Windows recovery step did not succeed: ${name}`);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery source metadata');
  return value as Record<string, unknown>;
}
