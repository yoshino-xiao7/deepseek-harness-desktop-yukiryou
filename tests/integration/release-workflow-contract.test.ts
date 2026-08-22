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
  needs?: string | string[];
  'timeout-minutes'?: number;
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs?: Record<string, WorkflowJob>;
}

describe('macOS release workflow contract', () => {
  it('keeps both READMEs linked and the current release notes bilingual', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };
    const [chineseReadme, englishReadme, releaseNotes] = await Promise.all([
      readFile(join(process.cwd(), 'README.md'), 'utf8'),
      readFile(join(process.cwd(), 'README_EN.md'), 'utf8'),
      readFile(
        join(
          process.cwd(),
          'docs',
          'releases',
          'v' + packageJson.version + '.md',
        ),
        'utf8',
      ),
    ]);

    expect(chineseReadme).toContain('href="README_EN.md"');
    expect(englishReadme).toContain('href="README.md"');
    expect(releaseNotes).toMatch(/^## 简体中文$/m);
    expect(releaseNotes).toMatch(/^## English$/m);
    expect(releaseNotes).not.toMatch(/^# /m);
  });

  it('publishes the verified Windows installer and portable ZIP beside macOS assets', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'release-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const release = workflow.jobs?.release;
    const commands = (release?.steps ?? [])
      .map((step) => step.run?.trim() ?? '')
      .join('\n');

    expect(release?.needs).toEqual(['verify_final', 'windows']);
    expect(commands).toContain('Windows candidate does not match this release');
    expect(commands).toContain('-win32-x64-Setup.exe');
    expect(commands).toContain('-portable.zip');
    expect(commands).toContain('SHA256SUMS-Windows.txt');
  });

  it('smoke-tests the executable extracted from the portable ZIP', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'windows-candidate.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const portableStep = workflow.jobs?.build_candidate?.steps?.find(
      (step) => step.name === 'Start and restart the exact portable ZIP application',
    );
    const command = portableStep?.run ?? '';

    expect(command).toContain(
      '$env:DSH_E2E_EXECUTABLE_PATH = $executables[0].FullName',
    );
    expect(command.indexOf('$env:DSH_E2E_EXECUTABLE_PATH')).toBeLessThan(
      command.indexOf('pnpm exec vitest run'),
    );
  });

  it('waits for Squirrel background cleanup before enforcing an empty install root', async () => {
    const lifecycleScript = await readFile(
      join(process.cwd(), 'scripts', 'windows-squirrel-lifecycle.ps1'),
      'utf8',
    );

    expect(lifecycleScript).toContain(
      "Wait-Until -FailureMessage 'Unexpected files remained after Squirrel uninstall'",
    );
    expect(lifecycleScript).toContain(
      '$script:unexpectedEntries = @(Get-UnexpectedInstallEntries)',
    );
    expect(lifecycleScript).not.toContain('vk_swiftshader.dll');
    expect(lifecycleScript).not.toContain('vk_swiftshader_icd.json');
  });

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
    expect(qualityCommands).toContain(
      'Release notes must omit the H1 because GitHub already renders the release title',
    );
    expect(qualityCommands).toContain(
      'Release notes must contain Simplified Chinese and English in the same file',
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

  it('soaks the installed candidate for thirty minutes before an Apple submission', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'release-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const soak = workflow.jobs?.soak_candidate;
    const commands = (soak?.steps ?? [])
      .map((step) => step.run?.trim() ?? '')
      .join('\n');

    expect(soak?.needs).toBe('verify_candidate');
    expect(soak?.['timeout-minutes']).toBe(60);
    expect(commands).toContain('--require-notarized=false');
    expect(commands).toContain('pnpm test:soak:app:release');
    expect(workflow.jobs?.notarize?.needs).toBe('soak_candidate');
  });

  it('gates notarization on candidate restart and previous-release upgrade checks', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'release-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const steps = workflow.jobs?.verify_candidate?.steps ?? [];
    const restartIndex = steps.findIndex((step) =>
      step.run?.includes('tests/e2e/session-selection-restart.test.ts'),
    );
    const downloadIndex = steps.findIndex((step) =>
      step.run?.includes('gh release download "v${UPGRADE_FROM_VERSION}"'),
    );
    const upgradeIndex = steps.findIndex(
      (step) => step.run?.trim() === 'pnpm test:upgrade',
    );

    expect(restartIndex).toBeGreaterThan(-1);
    expect(downloadIndex).toBeGreaterThan(restartIndex);
    expect(upgradeIndex).toBeGreaterThan(downloadIndex);
    expect(steps[downloadIndex]?.run).toContain(
      '${ARTIFACT_NAME}-darwin-arm64-${UPGRADE_FROM_VERSION}.zip',
    );
    expect(workflow.jobs?.soak_candidate?.needs).toBe('verify_candidate');
    expect(workflow.jobs?.notarize?.needs).toBe('soak_candidate');
  });

  it('keeps the five-hour soak in an independent scheduled workflow', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'extended-macos-soak.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const soak = workflow.jobs?.extended_soak;
    const commands = (soak?.steps ?? [])
      .map((step) => step.run?.trim() ?? '')
      .join('\n');

    expect(soak?.['timeout-minutes']).toBe(340);
    expect(commands).toContain('pnpm runtime:vendor -- --arch=arm64');
    expect(commands).toContain('pnpm package:mac -- --arch=arm64');
    expect(commands).toContain('pnpm test:soak:app:extended');
  });

  it('publishes releases in the channel consumed by update.electronjs.org', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'publish-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const steps = workflow.jobs?.verify_and_publish?.steps ?? [];
    const requireDraft = steps.find(
      (step) => step.name === 'Require an unpublished prerelease draft',
    );
    const checkout = steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    const publish = steps.find((step) => step.name === 'Publish release');

    expect(requireDraft?.run).toContain('targetCommitish');
    expect(requireDraft?.run).not.toContain('/git/ref/tags/');
    expect(checkout?.with?.ref).toBe('${{ steps.draft.outputs.target }}');
    expect(publish?.run).toContain('--draft=false');
    expect(publish?.run).toContain('--prerelease=false');
  });
});
