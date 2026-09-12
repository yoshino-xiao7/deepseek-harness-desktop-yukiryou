import { execFileSync } from 'node:child_process';
import { validateReleaseRecoverySources } from './release-recovery-policy.ts';

const repository = process.env.GITHUB_REPOSITORY ?? '';
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is required');
const sourceRunId = process.env.SOURCE_RUN_ID ?? '';
const windowsRunId = process.env.WINDOWS_SOURCE_RUN_ID || sourceRunId;

function readSource(id: string): { run: unknown; jobs: unknown[] } {
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('A numeric source run ID is required');
  const path = `repos/${repository}/actions/runs/${id}`;
  const run: unknown = JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
  const pages: unknown = JSON.parse(execFileSync('gh', ['api', `${path}/jobs?filter=latest&per_page=100`, '--paginate', '--slurp'], { encoding: 'utf8' }));
  if (!Array.isArray(pages)) throw new Error('Invalid job pages');
  const jobs: unknown[] = pages.flatMap(page => {
    if (page === null || typeof page !== 'object' || !Array.isArray(page.jobs)) throw new Error('Invalid job page');
    return page.jobs as unknown[];
  });
  return { run, jobs };
}

const mac = readSource(sourceRunId);
const windows = windowsRunId === sourceRunId ? mac : readSource(windowsRunId);
process.stdout.write(`${validateReleaseRecoverySources(repository, mac, windows)}\n`);
