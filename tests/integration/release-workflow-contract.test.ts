import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

interface WorkflowStep {
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  'timeout-minutes'?: number;
}

interface WorkflowJob {
  name?: string;
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  on?: {
    workflow_call?: {
      inputs?: Record<string, { default?: string | boolean }>;
    };
    workflow_dispatch?: {
      inputs?: Record<string, { default?: string | boolean }>;
    };
  };
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean;
  };
  jobs?: Record<string, WorkflowJob>;
}

describe('macOS release workflow contract', () => {
  it('runs the previous-release automatic-update gate before expensive release jobs', async () => {
    const workflow = parse(
      await readFile(
        join(process.cwd(), '.github', 'workflows', 'release-macos.yml'),
        'utf8',
      ),
    ) as ReleaseWorkflow;
    const automaticUpdate = workflow.jobs?.verify_macos_automatic_update;
    const automaticUpdateSteps = automaticUpdate?.steps ?? [];
    const downloadedArtifact = automaticUpdateSteps.find((step) =>
      step.uses?.startsWith('actions/download-artifact@'),
    );
    const mirror = automaticUpdateSteps.find(
      (step) => step.name === 'Create an isolated trusted mirror for the exact candidate',
    );
    const diagnostics = automaticUpdateSteps.find(
      (step) => step.name === 'Upload updater gate diagnostics',
    );
    const captureDiagnostics = automaticUpdateSteps.find(
      (step) => step.name === 'Capture Squirrel.Mac diagnostics',
    );
    const manualBridge = automaticUpdateSteps.find(
      (step) => step.name === 'Require the v1.0.4 manual-update bridge',
    );
    const strictUpdate = automaticUpdateSteps.find(
      (step) => step.name === 'Run the production updater through download, install, and relaunch',
    );

    expect(automaticUpdate?.needs).toBe('build_candidate');
    expect(downloadedArtifact?.with?.name).toBe('macos-release-candidate');
    expect(downloadedArtifact?.with?.path).toBe('out/release-candidate');
    expect(mirror?.run).toContain(
      '${PRODUCT_NAME}-darwin-arm64-${RELEASE_VERSION}-candidate.zip',
    );
    expect(mirror?.run).toContain(
      '${ARTIFACT_NAME}-darwin-arm64-${RELEASE_VERSION}.zip',
    );
    expect(mirror?.if).toContain("PREVIOUS_PUBLIC_VERSION != '1.0.4'");
    expect(manualBridge?.if).toContain("PREVIOUS_PUBLIC_VERSION == '1.0.4'");
    expect(manualBridge?.run).toContain('one-time manual update');
    expect(manualBridge?.run).toContain(
      '${PRODUCT_NAME}-darwin-arm64-${RELEASE_VERSION}-candidate.zip',
    );
    expect(strictUpdate?.if).toContain("PREVIOUS_PUBLIC_VERSION != '1.0.4'");
    expect(diagnostics?.with?.path).toContain('update-gate/diagnostics/');
    expect(diagnostics?.with?.path).not.toContain('update-gate/assets/');
    expect(captureDiagnostics?.run).toContain('-maxdepth 1 -type f');
    expect(captureDiagnostics?.run).not.toContain('cp -R');
    expect(workflow.jobs?.windows?.needs).toBe('verify_macos_automatic_update');
    expect(workflow.jobs?.verify_candidate?.needs).toBe(
      'verify_macos_automatic_update',
    );
    expect(workflow.jobs?.soak_candidate?.needs).toBe('verify_candidate');
    expect(workflow.jobs?.notarize?.needs).toBe('soak_candidate');
  });

  it('blocks release on the release candidate automatic update and relaunch gate', async () => {
    const [releaseSource, windowsSource, automaticUpdateTest, windowsGate] = await Promise.all([
      readFile(join(process.cwd(), '.github', 'workflows', 'release-macos.yml'), 'utf8'),
      readFile(join(process.cwd(), '.github', 'workflows', 'windows-candidate.yml'), 'utf8'),
      readFile(join(process.cwd(), 'tests', 'release', 'automatic-update.test.ts'), 'utf8'),
      readFile(join(process.cwd(), 'scripts', 'windows-automatic-update-gate.ps1'), 'utf8'),
    ]);
    const workflow = parse(releaseSource) as ReleaseWorkflow;
    const windowsWorkflow = parse(windowsSource) as ReleaseWorkflow;
    const release = workflow.jobs?.release;
    const windows = workflow.jobs?.windows as WorkflowJob & {
      with?: Record<string, string>;
    };

    expect(workflow.concurrency).toEqual({
      group: 'release-desktop-${{ inputs.version }}',
      'cancel-in-progress': false,
    });
    expect(windowsWorkflow.concurrency).toEqual({
      group: 'windows-candidate-${{ github.event.pull_request.number || github.run_id }}',
      'cancel-in-progress': true,
    });
    expect(releaseSource).not.toContain('UPGRADE_FROM_VERSION: 0.2.3-beta.3');
    expect(releaseSource).toContain('gh api "repos/${GITHUB_REPOSITORY}/releases/latest"');
    expect(releaseSource).toContain('tests/release/automatic-update.test.ts');
    expect(releaseSource).toContain('DSH_DESKTOP_DISTRIBUTION_REGION: china');
    expect(releaseSource).toContain('download-cn.suzuki.ink');
    expect(windowsSource).toContain('tests/release/automatic-update.test.ts');
    expect(windowsSource).toContain('DSH_DESKTOP_DISTRIBUTION_REGION: china');
    expect(windowsSource).toContain("inputs.release_version != ''");
    expect(windowsSource).toContain(
      'Exact candidate version when manually exercising the release updater gate',
    );
    expect(windows.with?.release_version).toBe('${{ inputs.version }}');
    const automaticUpdateStep = windowsWorkflow.jobs?.build_candidate?.steps?.find(
      (step) => step.name === 'Prepare and verify the release candidate automatic update',
    );
    const updateOnly = windowsWorkflow.jobs?.update_restart;
    const updateOnlyExercise = updateOnly?.steps?.find(
      (step) => step.name === 'Exercise only automatic update and restart',
    );
    expect(windowsSource).toContain('update_restart_only:');
    expect(
      windowsWorkflow.on?.workflow_call?.inputs?.update_restart_only?.default,
    ).toBe(false);
    expect(
      windowsWorkflow.on?.workflow_dispatch?.inputs?.update_restart_only?.default,
    ).toBe(true);
    expect(windowsWorkflow.jobs?.quality?.if).toContain('inputs.update_restart_only != true');
    expect(windowsWorkflow.jobs?.build_candidate?.if).toContain(
      'inputs.update_restart_only != true',
    );
    expect(updateOnly?.if).toContain('inputs.update_restart_only == true');
    expect(updateOnly?.['timeout-minutes']).toBe(35);
    expect(updateOnlyExercise?.run).toContain(
      './scripts/windows-automatic-update-gate.ps1 -Action Prepare',
    );
    expect(updateOnlyExercise?.run).toContain(
      'pnpm exec vitest run tests/release/automatic-update.test.ts --no-file-parallelism',
    );
    expect(updateOnly?.steps?.some((step) => step.run?.includes('pnpm lint'))).toBe(false);
    expect(updateOnly?.steps?.some((step) => step.run?.includes('pnpm test:integration'))).toBe(false);
    expect(updateOnly?.steps?.some((step) => step.run?.includes('pnpm make:win'))).toBe(false);
    expect(automaticUpdateStep?.['timeout-minutes']).toBe(25);
    expect(automaticUpdateStep?.run).toContain(
      './scripts/windows-automatic-update-gate.ps1 -Action Prepare',
    );
    expect(automaticUpdateStep?.run).toContain(
      'pnpm exec vitest run tests/release/automatic-update.test.ts --no-file-parallelism',
    );
    expect(automaticUpdateStep?.run?.indexOf('-Action Prepare')).toBeLessThan(
      automaticUpdateStep?.run?.indexOf('tests/release/automatic-update.test.ts') ?? -1,
    );
    expect(windowsWorkflow.jobs?.build_candidate?.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Upgrade the previous public Windows release and verify updater relaunch',
        }),
      ]),
    );
    expect(release?.needs).toEqual(expect.arrayContaining([
      'verify_final', 'windows', 'verify_macos_automatic_update',
    ]));
    expect(automaticUpdateTest).toContain("invokeUpdate(shell, 'check')");
    expect(automaticUpdateTest).toContain("invokeUpdate(shell, 'install')");
    expect(automaticUpdateTest).toContain('waitForPreviousMacUpdaterReadiness');
    expect(automaticUpdateTest).toContain('PREVIOUS_PUBLIC_VERSION');
    expect(automaticUpdateTest).toContain("previousVersion !== '1.0.3'");
    expect(automaticUpdateTest.indexOf('hasStagedMacUpdate(version)')).toBeLessThan(
      automaticUpdateTest.indexOf("previousVersion !== '1.0.3'"),
    );
    expect(automaticUpdateTest).toContain('updates[value]()');
    expect(automaticUpdateTest).toContain('relaunch');
    expect(automaticUpdateTest).not.toContain("DSH_DESKTOP_E2E: '1'");
    expect(windowsGate).toContain("$mirrorHost = '127.0.0.1'");
    expect(windowsGate).toContain("$mirrorOrigin = \"http://$mirrorHost`:$mirrorPort$mirrorBasePath\"");
    expect(windowsGate).toContain("$mirrorBasePath = '/mirrorx'");
    expect(windowsGate).toContain('$env:GITHUB_RUN_ID');
    expect(windowsGate).toContain('$env:GITHUB_RUN_ATTEMPT');
    expect(windowsGate).toContain('Remove-StaleGateInstallations');
    expect(windowsGate).toContain("-Filter 'dsh-au-*'");
    expect(windowsGate).toContain("-Filter 'dsh-yukiryou-automatic-update-*'");
    expect(windowsGate).toContain(
      '$installParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())',
    );
    expect(windowsGate).toContain('$installRoot = Join-Path $installParent "dsh-au-$gateIdentity"');
    expect(windowsGate).not.toContain('if ($env:LOCALAPPDATA)');
    expect(windowsGate).toContain('Recovering stale automatic-update installation');
    expect(windowsGate).toContain('function Remove-DirectoryEventually');
    expect(windowsGate).toContain('if (-not (Test-Path -LiteralPath $Root)) { return }');
    expect(windowsGate).toContain('[System.StringComparison]::OrdinalIgnoreCase');
    expect(windowsGate).not.toContain('gh api');
    expect(windowsGate).not.toContain('download-cn.suzuki.ink/releases/$previousTag');
    expect(windowsGate).not.toContain('Previous release asset SHA-256 mismatch');
    expect(windowsGate).toContain('function Install-CandidateUnderTest');
    expect(windowsGate).toContain('$maximumAttempts = 2');
    expect(windowsGate).toContain('cleaning the isolated directory before one retry');
    expect(windowsGate).toContain('Install-CandidateUnderTest $candidateSource $env:RELEASE_VERSION');
    expect(windowsGate).toContain('$syntheticSuccessorVersion');
    expect(windowsGate).toContain('Building a real synthetic successor installer with embedded version');
    expect(windowsGate).toContain('Preparing a successor application whose packaged version is');
    expect(windowsGate).toContain('"--version=$syntheticSuccessorVersion"');
    expect(windowsGate).toContain("Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_INSTALLED_VERSION' $syntheticSuccessorVersion");
    expect(windowsGate).toContain('"-c.extraMetadata.version=$syntheticSuccessorVersion"');
    expect(windowsGate).toContain("VersionInfo.ProductVersion");
    expect(windowsGate).not.toContain('Copying the candidate installer as synthetic successor');
    expect(windowsGate).not.toContain('Cert:\\CurrentUser\\Root');
    expect(windowsGate).not.toContain('certutil.exe');
    expect(windowsGate).toContain("'--protocol=http'");
    expect(windowsGate).toContain("Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_SOURCE_EXECUTABLE_PATH'");
    expect(windowsGate).toContain("Set-GateEnvironment 'DSH_AUTOMATIC_UPDATE_INSTALLED_VERSION'");
    expect(windowsGate).not.toContain('RUNNER_TRACKING_ID');
    expect(windowsGate).not.toContain('$hostsPath');
    expect(windowsGate).toContain('patch-packaged-update-origin.ts');
    expect(windowsGate).not.toContain("$mirrorHost = 'localhost'");
    expect(windowsGate).toContain("$mirrorBasePath = '/mirrorx'");
    expect(windowsGate).toContain('$mirrorPort = 41337');
    expect(windowsGate).toContain('$env:NO_PROXY = $noProxy');
    expect(windowsGate).toContain('"NO_PROXY=$noProxy"');
    expect(windowsGate).not.toContain('DSH_AUTOMATIC_UPDATE_MIRROR_HOST');
    expect(windowsGate).toContain('DSH_AUTOMATIC_UPDATE_MIRROR_METADATA_URL');
    expect(windowsGate).not.toContain('DSH_AUTOMATIC_UPDATE_CERTIFICATE_SPKI_PIN');
    expect(windowsGate).toContain('DSH_AUTOMATIC_UPDATE_DIAGNOSTICS');
    expect(windowsGate).toContain('if ($server.HasExited)');
    expect(automaticUpdateTest).toContain("'--no-proxy-server'");
    expect(automaticUpdateTest).not.toContain('--host-resolver-rules=MAP');
    expect(automaticUpdateTest).toContain("fromPartition('electron-updater'");
    expect(automaticUpdateTest).toContain("setProxy({ mode: 'direct' })");
    expect(automaticUpdateTest).toContain('Updater mirror preflight did not expose the expected version');
    expect(automaticUpdateTest).toContain('--ignore-certificate-errors-spki-list=');
    expect(automaticUpdateTest).toContain('Updater reached terminal status before download');
    expect(automaticUpdateTest).toContain('DSH_AUTOMATIC_UPDATE_SOURCE_EXECUTABLE_PATH');
    expect(automaticUpdateTest).toContain('DSH_AUTOMATIC_UPDATE_INSTALLED_VERSION');
    expect(releaseSource).toContain('DSH_AUTOMATIC_UPDATE_DIAGNOSTICS');
    expect(releaseSource).toContain('Capture Squirrel.Mac diagnostics');
    expect(automaticUpdateTest).toContain('installed-version.txt');
    expect(automaticUpdateTest).toContain('relaunched-desktop.log');
    expect(windowsGate).not.toContain('& gh release download');
    expect(windowsGate).not.toContain(
      "Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-yukiryou-automatic-update'",
    );
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
    expect(lifecycleScript).toContain("Contains('exit code -1073741819')");
    expect(lifecycleScript).toContain('cleaning the isolated directory before one retry');
    expect(lifecycleScript).toContain('if (-not $isTransientAccessViolation -or $attempt -ge $maximumAttempts) { throw }');
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

  it('activates the previous-release session through the real sidebar before closing it', async () => {
    const source = await readFile(
      join(process.cwd(), 'tests', 'release', 'previous-version-upgrade.test.ts'),
      'utf8',
    );

    expect(source).toContain('await activateHarnessUiSelection(');
    expect(source).toContain("document.querySelectorAll('[role=\"treeitem\"][aria-selected]')");
    expect(source).toContain('const deadline = Date.now() + 15_000;');
    expect(source).toContain('row.click();');
    expect(source).not.toContain('window.localStorage.setItem(');
    expect(source).toContain('unexpected.length <= 1');
    expect(source).toContain('unexpected.every((session) => session.blank)');
    expect(source).toMatch(
      /activateHarnessUiSelection\([\s\S]+?readCurrentSessionId\(electronApp!\)[\s\S]+?electronApp\.close\(\)/,
    );
    expect(source).not.toContain('async function writeHarnessStorage(');
  });

  it('can isolate the previous-version upgrade gate against an existing candidate', async () => {
    const workflowSource = await readFile(
      join(process.cwd(), '.github', 'workflows', 'macos-upgrade-candidate.yml'),
      'utf8',
    );
    const workflow = parse(workflowSource) as ReleaseWorkflow;
    const job = workflow.jobs?.validate_upgrade;
    const commands = (job?.steps ?? [])
      .map((step) => step.run?.trim() ?? '')
      .join('\n');

    expect(job?.name).toBe('Exercise only previous-version upgrade');
    expect(workflowSource).toContain('source_run_id:');
    expect(workflowSource).toContain('source_sha:');
    expect(commands).toContain('.github/workflows/release-macos.yml');
    expect(commands).toContain('candidate-manifest.json');
    expect(commands).toContain("createHash('sha256')");
    expect(commands).not.toContain('m.dirtyWorktree');
    expect(commands).toContain('pnpm test:upgrade');
    expect(commands).not.toContain('release:mac:candidate');
    expect(commands).not.toContain('gh release create');
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
