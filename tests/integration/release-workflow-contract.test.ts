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
  if?: string;
  'timeout-minutes'?: number;
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs?: Record<string, WorkflowJob>;
}

describe('macOS release workflow contract', () => {
  it('blocks release on a real previous-public-version automatic update and relaunch gate', async () => {
    const [releaseSource, windowsSource, automaticUpdateTest, windowsGate] = await Promise.all([
      readFile(join(process.cwd(), '.github', 'workflows', 'release-macos.yml'), 'utf8'),
      readFile(join(process.cwd(), '.github', 'workflows', 'windows-candidate.yml'), 'utf8'),
      readFile(join(process.cwd(), 'tests', 'release', 'automatic-update.test.ts'), 'utf8'),
      readFile(join(process.cwd(), 'scripts', 'windows-automatic-update-gate.ps1'), 'utf8'),
    ]);
    const workflow = parse(releaseSource) as ReleaseWorkflow;
    const release = workflow.jobs?.release;
    const windows = workflow.jobs?.windows as WorkflowJob & {
      with?: Record<string, string>;
    };

    expect(releaseSource).not.toContain('UPGRADE_FROM_VERSION: 0.2.3-beta.3');
    expect(releaseSource).toContain('gh api "repos/${GITHUB_REPOSITORY}/releases/latest"');
    expect(releaseSource).toContain('tests/release/automatic-update.test.ts');
    expect(releaseSource).toContain('DSH_DESKTOP_DISTRIBUTION_REGION: china');
    expect(releaseSource).toContain('download-cn.suzuki.ink');
    expect(windowsSource).toContain('tests/release/automatic-update.test.ts');
    expect(windowsSource).toContain('DSH_DESKTOP_DISTRIBUTION_REGION: china');
    expect(windowsSource).toContain("inputs.release_version != ''");
    expect(windows.with?.release_version).toBe('${{ inputs.version }}');
    expect(release?.needs).toEqual(expect.arrayContaining([
      'verify_final', 'windows', 'verify_macos_automatic_update',
    ]));
    expect(automaticUpdateTest).toContain("invokeUpdate(shell, 'check')");
    expect(automaticUpdateTest).toContain("invokeUpdate(shell, 'install')");
    expect(automaticUpdateTest).toContain('updates[value]()');
    expect(automaticUpdateTest).toContain('relaunch');
    expect(automaticUpdateTest).not.toContain("DSH_DESKTOP_E2E: '1'");
    expect(windowsGate).toContain('CertificateRequest');
    expect(windowsGate).toContain('SubjectAlternativeNameBuilder');
    expect(windowsGate).toContain('ExportPkcs8PrivateKeyPem');
    expect(windowsGate).not.toContain('& openssl');
  });

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

    expect(release?.needs).toEqual([
      'verify_final',
      'windows',
      'verify_macos_automatic_update',
    ]);
    expect(commands).toContain('Windows candidate does not match this release');
    expect(commands).toContain('-win32-x64-Setup.exe');
    expect(commands).toContain('-portable.zip');
    expect(commands).toContain('SHA256SUMS-Windows.txt');
    expect(commands).toContain('release_flags=(--draft)');
    expect(commands).toContain('release_flags+=(--prerelease)');
  });

  it('publishes updater metadata for the notarized macOS ZIP and Windows installer', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'release-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const steps = workflow.jobs?.release?.steps ?? [];
    const metadataIndex = steps.findIndex(
      (step) => step.name === 'Generate cross-platform auto-update metadata',
    );
    const draftIndex = steps.findIndex(
      (step) => step.name === 'Create immutable draft release',
    );
    const commands = steps.map((step) => step.run?.trim() ?? '').join('\n');

    expect(metadataIndex).toBeGreaterThan(-1);
    expect(draftIndex).toBeGreaterThan(metadataIndex);
    expect(commands).toContain('prepare-update-metadata.ts');
    expect(commands).toContain('latest-mac.yml');
    expect(commands).toContain('latest.yml');
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
    const updaterBootstrapStep = workflow.jobs?.build_candidate?.steps?.find(
      (step) => step.name === 'Verify updater bootstrap in packaged Windows application',
    );

    expect(updaterBootstrapStep?.run).toContain('app-update.yml');
    expect(command).toContain(
      '$env:DSH_E2E_EXECUTABLE_PATH = $executables[0].FullName',
    );
    expect(command).toContain("-Filter 'app-update.yml'");
    expect(command.indexOf('$env:DSH_E2E_EXECUTABLE_PATH')).toBeLessThan(
      command.indexOf('pnpm exec vitest run'),
    );
  });

  it('probes the input desktop instead of mistaking RDP processes for a lock', async () => {
    const [candidateWorkflow, publishedWorkflow, desktopProbe] = await Promise.all([
      readFile(
        join(process.cwd(), '.github', 'workflows', 'windows-candidate.yml'),
        'utf8',
      ),
      readFile(
        join(
          process.cwd(),
          '.github',
          'workflows',
          'windows-published-diagnostics.yml',
        ),
        'utf8',
      ),
      readFile(
        join(
          process.cwd(),
          'scripts',
          'require-interactive-windows-desktop.ps1',
        ),
        'utf8',
      ),
    ]);

    for (const workflow of [candidateWorkflow, publishedWorkflow]) {
      expect(workflow).toContain(
        './scripts/require-interactive-windows-desktop.ps1',
      );
      expect(workflow).not.toContain('Get-Process LogonUI');
    }
    expect(desktopProbe).toContain('OpenInputDesktop');
    expect(desktopProbe).toContain('SwitchDesktop');
    expect(desktopProbe).toContain('Get-Process explorer');
    expect(desktopProbe).toContain('the packaged Electron UI tests remain the authoritative gate');
    expect(desktopProbe).toContain('Write-Warning');
    expect(desktopProbe).not.toContain('Get-Process LogonUI');
    expect(desktopProbe).not.toContain(
      'throw "Windows desktop Session $sessionId is not available',
    );
  });

  it('exercises guided NSIS install, repair, and uninstall in an isolated directory', async () => {
    const [lifecycleScript, electronCleanup, windowsCandidate] = await Promise.all([
      readFile(
        join(process.cwd(), 'scripts', 'windows-nsis-lifecycle.ps1'),
        'utf8',
      ),
      readFile(join(process.cwd(), 'tests', 'e2e', 'electron-cleanup.ts'), 'utf8'),
      readFile(
        join(process.cwd(), '.github', 'workflows', 'windows-candidate.yml'),
        'utf8',
      ),
    ]);

    expect(lifecycleScript).toContain("@('/S', '/currentuser', \"/D=$installRoot\")");
    expect(lifecycleScript).toContain("'Uninstall DeepSeek YukiRyou.exe'");
    expect(lifecycleScript).toContain('$process.WaitForExit(15000)');
    expect(lifecycleScript).toContain('.AddMinutes(10)');
    expect(lifecycleScript).toContain('[System.IO.Path]::GetFullPath');
    expect(lifecycleScript).toContain("[System.IO.Path]::GetTempPath()) 'dsh-yukiryou-nsis-install'");
    expect(lifecycleScript).toContain('NSIS install, repair, and uninstall checks passed');
    expect(windowsCandidate).toContain("Get-Process -Name 'DeepSeek YukiRyou'");
    expect(windowsCandidate).toContain('windows-installed-diagnostics');
    expect(windowsCandidate).toContain('windows-installed-startup-diagnostics');
    expect(electronCleanup).toContain("'taskkill.exe'");
    expect(electronCleanup).toContain("'/t', '/f'");
    expect(electronCleanup).toContain('applicationProcess.exitCode !== null');
  });

  it('only recovers the isolated NSIS lifecycle directory', async () => {
    const [workflowSource, lifecycleScript] = await Promise.all([
      readFile(
        join(process.cwd(), '.github', 'workflows', 'windows-candidate.yml'),
        'utf8',
      ),
      readFile(
        join(process.cwd(), 'scripts', 'windows-nsis-lifecycle.ps1'),
        'utf8',
      ),
    ]);

    expect(workflowSource).toContain(
      './scripts/windows-nsis-lifecycle.ps1 -Action Recover',
    );
    expect(lifecycleScript).toContain(
      "Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-yukiryou-nsis-install'",
    );
    expect(lifecycleScript).toContain('Lifecycle state points outside the isolated install directory');
    expect(lifecycleScript).toContain("Remove-Item -LiteralPath $stateRoot -Recurse -Force");
    expect(lifecycleScript).toContain("Remove-Item -LiteralPath $installRoot -Recurse -Force");
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
    expect(commands).toContain('release_flags=(--draft)');
    expect(commands).toContain('release_flags+=(--prerelease)');
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
    const workflowSource = await readFile(
        join(process.cwd(), '.github', 'workflows', 'release-macos.yml'),
        'utf8',
      );
    const workflow = parse(workflowSource) as ReleaseWorkflow;
    const steps = workflow.jobs?.verify_candidate?.steps ?? [];
    const restartIndex = steps.findIndex((step) =>
      step.run?.includes('tests/e2e/session-selection-restart.test.ts'),
    );
    const downloadIndex = steps.findIndex((step) =>
      step.run?.includes('gh release download "${previous_tag}"'),
    );
    const upgradeIndex = steps.findIndex(
      (step) => step.run?.trim() === 'pnpm test:upgrade',
    );

    expect(restartIndex).toBeGreaterThan(-1);
    expect(downloadIndex).toBeGreaterThan(restartIndex);
    expect(upgradeIndex).toBeGreaterThan(downloadIndex);
    expect(steps[downloadIndex]?.run).toContain(
      '${ARTIFACT_NAME}-darwin-arm64-${previous_version}.zip',
    );
    expect(workflowSource).toContain('repos/${GITHUB_REPOSITORY}/releases/latest');
    expect(workflowSource).not.toContain('UPGRADE_FROM_VERSION: 0.2.3-beta.3');
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
      (step) => step.name === 'Require an unpublished matching draft',
    );
    const checkout = steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    const publish = steps.find((step) => step.name === 'Publish release');
    const metadataVerification = steps.find(
      (step) => step.name === 'Verify auto-update metadata binds the exact release bytes',
    );

    expect(requireDraft?.run).toContain('targetCommitish');
    expect(requireDraft?.run).toContain("RELEASE_VERSION.includes('-')");
    expect(requireDraft?.run).not.toContain('/git/ref/tags/');
    expect(checkout?.with?.ref).toBe('${{ steps.draft.outputs.target }}');
    expect(publish?.run).toContain('--draft=false');
    expect(publish?.run).toContain('--prerelease=false');
    expect(publish?.run).toContain('--latest');
    expect(metadataVerification?.run).toContain('verify-update-metadata.ts');
  });

  it('mirrors only a public verified release and publishes mutable China metadata last', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'publish-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const mirror = workflow.jobs?.sync_china_mirror;
    const steps = mirror?.steps ?? [];
    const commands = steps.map((step) => step.run?.trim() ?? '').join('\n');
    const immutableIndex = steps.findIndex(
      (step) => step.name === 'Upload and verify immutable versioned release objects',
    );
    const mutableIndex = steps.findIndex(
      (step) =>
        step.name === 'Publish mutable update, website, and plugin metadata last',
    );

    expect(mirror?.needs).toBe('verify_and_publish');
    expect(mirror?.if).toBe("${{ !contains(inputs.version, '-') }}");
    expect(commands).toContain('r.isDraft || r.isPrerelease');
    expect(commands).toContain('sha256sum -c SHA256SUMS-Windows.txt');
    expect(commands).toContain('china-mirror/downloads/latest.json');
    expect(commands).toContain('oss://${OSS_BUCKET}/downloads/latest.json');
    expect(commands).toContain(
      'cmp china-mirror/downloads/latest.json mutable-verification/downloads-latest.json',
    );
    expect(commands).not.toContain('always()');
    expect(immutableIndex).toBeGreaterThan(-1);
    expect(mutableIndex).toBeGreaterThan(immutableIndex);
  });

  it('retries only the known transient hdiutil resource-busy failure', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts', 'release-macos.ts'),
      'utf8',
    );
    expect(source).toContain('const maximumAttempts = 3');
    expect(source).toContain('/resource busy/iu');
    expect(source).toContain('await createDiskImageWithRetry');
  });
});
