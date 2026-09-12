import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateReleaseRecoverySources } from '../../scripts/release-recovery-policy.js';

const repository = 'owner/desktop';
const sha = '1c555befd9175af1778baf011018bc3413b0440d';
interface WorkflowJob {
  name: string;
  steps?: { name?: string; run?: string; uses?: string }[];
}
function workflow(name: string): WorkflowJob[] {
  const value = parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')) as { jobs: Record<string, WorkflowJob> };
  return Object.values(value.jobs);
}
function fixture() {
  const run = {
    head_sha: sha, head_branch: 'main', event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
    path: '.github/workflows/release-macos.yml', repository: { full_name: repository }, head_repository: { full_name: repository },
  };
  const job = (definition: WorkflowJob) => ({
    name: definition.name, conclusion: 'success',
    steps: (definition.steps ?? []).map(step => ({
      name: step.name ?? `Run ${step.run ?? step.uses}`, conclusion: 'success',
    })),
  });
  return {
    mac: { run: { ...run, conclusion: 'failure' }, jobs: workflow('release-macos').map(job) },
    windows: { run: { ...structuredClone(run), path: '.github/workflows/windows-candidate.yml' }, jobs: workflow('windows-candidate').map(job) },
  };
}

describe('release recovery provenance and gates', () => {
  it('accepts independently verified Windows bytes at the exact macOS commit', () => {
    const { mac, windows } = fixture();
    expect(validateReleaseRecoverySources(repository, mac, windows)).toBe(sha);
  });

  it('retains support for a single release run with successful nested Windows gates', () => {
    const { mac, windows } = fixture();
    mac.jobs.push(...windows.jobs.map(job => ({ ...job, name: `Build and verify Windows EXE + portable ZIP / ${job.name}` })));
    expect(validateReleaseRecoverySources(repository, mac, mac)).toBe(sha);
  });

  it.each([
    ['head_sha', 'a'.repeat(40)], ['head_branch', 'feature'], ['event', 'pull_request'],
    ['status', 'in_progress'], ['conclusion', 'failure'], ['path', '.github/workflows/untrusted.yml'],
  ] as const)('rejects an ineligible Windows source: %s=%s', (field, value) => {
    const { mac, windows } = fixture();
    windows.run[field] = value;
    expect(() => validateReleaseRecoverySources(repository, mac, windows)).toThrow();
  });

  it.each(['repository', 'head_repository'] as const)('rejects foreign %s metadata', field => {
    const { mac, windows } = fixture();
    windows.run[field].full_name = 'someone/else';
    expect(() => validateReleaseRecoverySources(repository, mac, windows)).toThrow();
  });

  it.each(['failure', 'skipped'])('rejects a %s Windows build even when an artifact exists', conclusion => {
    const { mac, windows } = fixture();
    windows.jobs.find(job => job.name === 'Vendor Runtime, make EXE + portable ZIP, and smoke')!.conclusion = conclusion;
    expect(() => validateReleaseRecoverySources(repository, mac, windows)).toThrow();
  });

  it.each([
    'Prepare and verify the release candidate automatic update',
    'Install the frozen guided NSIS candidate',
    'Repair-install the same candidate and restart it',
    'Uninstall and verify shortcuts and user-data retention',
  ])('rejects skipped release-only validation: %s', name => {
    const { mac, windows } = fixture();
    windows.jobs.flatMap(job => job.steps).find(step => step.name === name)!.conclusion = 'skipped';
    expect(() => validateReleaseRecoverySources(repository, mac, windows)).toThrow(name);
  });

  it('rejects a source with only update/restart validation', () => {
    const { mac, windows } = fixture();
    windows.jobs = windows.jobs.filter(job => job.name === 'Update and restart only');
    expect(() => validateReleaseRecoverySources(repository, mac, windows)).toThrow();
  });

  it.each(['Thirty-minute installed candidate soak', 'Notarize the exact verified candidate', 'Fresh-runner final DMG and ZIP gate'])('requires the macOS gate: %s', name => {
    const { mac, windows } = fixture();
    mac.jobs = mac.jobs.filter(job => job.name !== name);
    expect(() => validateReleaseRecoverySources(repository, mac, windows)).toThrow(name);
  });

  it('rejects ambiguous repeated jobs rather than selecting a successful attempt', () => {
    const { mac, windows } = fixture();
    windows.jobs.push({ ...windows.jobs[0]!, conclusion: 'failure' });
    expect(() => validateReleaseRecoverySources(repository, mac, windows)).toThrow();
  });
});
