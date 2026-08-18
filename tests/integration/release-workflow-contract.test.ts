import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs?: Record<string, WorkflowJob>;
}

describe('macOS release workflow contract', () => {
  it('vendors the bundled runtime before running integration tests', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'release-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const steps = workflow.jobs?.build_candidate?.steps ?? [];
    const qualityCommands = (workflow.jobs?.quality?.steps ?? [])
      .map((step) => step.run?.trim() ?? '')
      .join('\n');
    const releaseCommands = (workflow.jobs?.release?.steps ?? [])
      .map((step) => step.run?.trim() ?? '')
      .join('\n');
    const commands = steps.map((step) => step.run?.trim() ?? '');
    const vendorIndex = commands.indexOf(
      'pnpm runtime:vendor -- --arch=arm64',
    );
    const integrationIndex = commands.indexOf('pnpm test:integration');
    const certificateIndex = steps.findIndex((step) =>
      step.name?.startsWith('Import Developer ID certificate'),
    );

    expect(vendorIndex).toBeGreaterThan(-1);
    expect(integrationIndex).toBeGreaterThan(vendorIndex);
    expect(certificateIndex).toBeGreaterThan(integrationIndex);
    expect(qualityCommands).toContain(
      'test -s "docs/releases/${RELEASE_TAG}.md"',
    );
    expect(releaseCommands).toContain(
      '--notes-file "docs/releases/${RELEASE_TAG}.md"',
    );
  });

  it('can resume from accepted notarized artifacts without resubmitting to Apple', async () => {
    const workflow = parse(
      await readFile(
        join(
          process.cwd(),
          '.github',
          'workflows',
          'resume-macos-release.yml',
        ),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const steps = workflow.jobs?.verify_and_create_draft?.steps ?? [];
    const commands = steps.map((step) => step.run?.trim() ?? '').join('\n');
    const download = steps.find((step) =>
      step.uses?.startsWith('actions/download-artifact@'),
    );
    const verifyDmgIndex = steps.findIndex(
      (step) => step.name === 'Verify DMG through Applications',
    );
    const createDraftIndex = steps.findIndex(
      (step) => step.name === 'Create immutable draft release',
    );

    expect(download?.with?.['run-id']).toBe('${{ inputs.source_run_id }}');
    expect(commands).not.toContain('release:mac');
    expect(commands).not.toContain('notarytool submit');
    expect(commands).toContain(
      '--notes-file "docs/releases/${RELEASE_TAG}.md"',
    );
    expect(commands).toContain('tag_sha=');
    expect(commands).toContain('"${tag_sha}" != "${source_sha}"');
    expect(commands).not.toContain('--target "${SOURCE_SHA}"');
    expect(verifyDmgIndex).toBeGreaterThan(-1);
    expect(createDraftIndex).toBeGreaterThan(verifyDmgIndex);
  });

  it('publishes releases in the channel consumed by update.electronjs.org', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'publish-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const steps = workflow.jobs?.verify_and_publish?.steps ?? [];
    const publish = steps.find((step) => step.name === 'Publish release');

    expect(publish?.run).toContain('--draft=false');
    expect(publish?.run).toContain('--prerelease=false');
  });
});
