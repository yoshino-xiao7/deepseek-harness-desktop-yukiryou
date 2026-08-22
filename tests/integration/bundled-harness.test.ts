import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createRuntimeSupervisor,
  type RuntimeSupervisor,
} from '../../src/main/runtime/runtime-supervisor.js';
import { runtimeStartupTimeoutMs } from '../../src/main/runtime/runtime-startup-policy.js';
import { createHarnessRuntimeCommand } from '../../src/main/runtime/runtime-command.js';
import { ensureDesktopSettingsExtension } from '../../src/main/runtime/runtime-extension.js';
import { resolveBundledRuntimePlatform } from '../../src/main/runtime/runtime-platform.js';
import { createPluginProfileBootstrap } from '../../src/main/runtime/plugin-profile-bootstrap.js';

const projectRoot = process.cwd();
const execFileAsync = promisify(execFile);

describe('bundled Harness runtime', () => {
  let supervisor: RuntimeSupervisor | undefined;

  afterEach(async () => {
    await supervisor?.stop('quit');
  });

  it('ships the rc.8-scoped per-model capability editor patch', async () => {
    const client = await readFile(
      join(
        projectRoot,
        'resources',
        'runtime',
        'dsh',
        'node_modules',
        '@deepseek-ai',
        'dsh-client-ui-settings-models',
        'lib',
        'client.js',
      ),
      'utf8',
    );

    expect(client).toContain(
      'deepseek-yukiryou:model-capabilities-patch:v1',
    );
    expect(client).toContain('modelInputCapability: "输入能力"');
    expect(client).toContain(
      'patch(index, { input: capability === "vision" ? ["text", "image"]',
    );
    expect(client).not.toContain('defaultInput: ["text", "image"]');
  });

  it(
    'serves the official Harness UI from an isolated Runtime Home',
    async () => {
      const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-real-home-'));
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-real-workspace-'));
      const runtimeRoot = join(projectRoot, 'resources', 'runtime');
      const runtimeLayout = resolveBundledRuntimePlatform(process.platform, process.arch);
      await ensureDesktopSettingsExtension(runtimeHome, runtimeRoot);
      const managedPatch = join(runtimeHome, 'managed-profile.patch.yml');
      await writeFile(managedPatch, '[]\n');
      const runtimeCommand = createHarnessRuntimeCommand(
        runtimeRoot,
        'legacy',
        [managedPatch],
      );
      const dshVersion = await execFileAsync(runtimeCommand.command, [
        join(
          runtimeRoot,
          'dsh',
          'node_modules',
          '@deepseek-ai',
          'dsh',
          'lib',
          'bin.js',
        ),
        '--version',
      ]);
      expect(dshVersion.stdout.trim()).toBe('0.1.0-rc.8');
      supervisor = createRuntimeSupervisor({
        command: runtimeCommand.command,
        args: runtimeCommand.args,
        runtimeHome,
        runtimeBinDirectories: [
          join(runtimeRoot, 'dsh', 'node_modules', '.bin'),
          join(runtimeRoot, runtimeLayout.nodeBinDirectory),
        ],
        workspaceRoot,
        version: '0.1.0-rc.8',
        startupTimeoutMs: runtimeStartupTimeoutMs(),
        shutdownTimeoutMs: 5_000,
        createCompanionToken: () => 'integration-token-that-is-long-enough-123456789',
      });

      const ready = await supervisor.start();
      const response = await fetch(ready.origin);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      expect(html).toContain('@dsh-desktop/settings');
      expect(html).toContain('@dsh-desktop/companion');
      const pluginResponse = await fetch(
        `${ready.origin}/plugins/@dsh-desktop/settings/client.js`,
      );
      expect(pluginResponse.status).toBe(200);
      await expect(pluginResponse.text()).resolves.toContain(
        "id: '@dsh-desktop/settings'",
      );
      const brandResponse = await fetch(
        `${ready.origin}/plugins/@dsh-desktop/settings/brand.png`,
      );
      expect(brandResponse.status).toBe(200);
      expect(brandResponse.headers.get('content-type')).toContain('image/png');
      const companionClient = await fetch(
        `${ready.origin}/plugins/@dsh-desktop/companion/client.js`,
      );
      expect(companionClient.status).toBe(200);
      const companionScript = await companionClient.text();
      expect(companionScript).toContain("conversation.chat.turnTail");
      expect(companionScript).toContain("desktop-turn-changes");
      expect(companionScript).toContain("deepSeekYukiRyouReview");
      const unauthorized = await fetch(
        `${ready.origin}/plugins/@dsh-desktop/companion/rpc`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"account.balance"}' },
      );
      expect(unauthorized.status).toBe(403);
      const unauthorizedMarket = await fetch(
        `${ready.origin}/plugins/@dsh-desktop/market/managed-rpc`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"stage","previewId":"invalid"}' },
      );
      expect(unauthorizedMarket.status).toBe(403);
      const authenticatedMarket = await fetch(
        `${ready.origin}/plugins/@dsh-desktop/market/managed-rpc`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dsh-desktop-companion-token': 'integration-token-that-is-long-enough-123456789',
          },
          body: '{"kind":"unsupported"}',
        },
      );
      expect(authenticatedMarket.status).toBe(400);
      const balance = await fetch(
        `${ready.origin}/plugins/@dsh-desktop/companion/rpc`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dsh-desktop-companion-token': 'integration-token-that-is-long-enough-123456789',
          },
          body: '{"kind":"account.balance"}',
        },
      );
      expect(balance.status).toBe(200);
      await expect(balance.json()).resolves.toEqual({
        status: 'unavailable',
        reason: 'credential-unconfigured',
      });
    },
    75_000,
  );

  it(
    'loads the managed development fixture from its staged generation',
    async () => {
      const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-fixture-home-'));
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-fixture-workspace-'));
      const runtimeRoot = join(projectRoot, 'resources', 'runtime');
      const runtimeLayout = resolveBundledRuntimePlatform(process.platform, process.arch);
      await ensureDesktopSettingsExtension(runtimeHome, runtimeRoot);
      const marketRoot = new URL(
        '../../resources/runtime/dsh/node_modules/@dsh-desktop/market/',
        import.meta.url,
      );
      const [{ createArtifactCache }, { createManagedPluginInstaller }, { createManagedPreviewVault }, { createDevelopmentFixture }] =
        await Promise.all([
          import(new URL('artifact-cache.js', marketRoot).href),
          import(new URL('managed-installer.js', marketRoot).href),
          import(new URL('managed-preview-vault.js', marketRoot).href),
          import(new URL('development-fixture.js', marketRoot).href),
        ]);
      const artifactCache = createArtifactCache({ root: runtimeHome });
      const fixture = createDevelopmentFixture({ enabled: true, artifactStore: artifactCache });
      if (fixture === undefined) throw new Error('Development fixture is unavailable');
      const vault = createManagedPreviewVault({
        inspector: fixture,
        installer: createManagedPluginInstaller({ root: runtimeHome, artifactStore: artifactCache }),
        artifactCache,
        randomId: () => '00000000-0000-4000-8000-000000000002',
        schedule: () => undefined,
        cancel: () => undefined,
      });
      const preview = await vault.issue({
        sourceRecordId: fixture.sourceId,
        itemId: fixture.itemId,
      });
      const staged = await vault.stage(preview.previewId);
      const bootstrap = createPluginProfileBootstrap(runtimeHome);
      await bootstrap.prepare(
        staged.profileGeneration,
        staged.candidate,
        staged.cacheDigests,
      );
      const launchPlan = await bootstrap.prepareRuntimeLaunch();
      const runtimeCommand = createHarnessRuntimeCommand(
        runtimeRoot,
        'legacy',
        launchPlan.patchPaths,
      );
      const runtimeOutput: string[] = [];
      supervisor = createRuntimeSupervisor({
        command: runtimeCommand.command,
        args: runtimeCommand.args,
        runtimeHome,
        runtimeBinDirectories: [
          join(runtimeRoot, 'dsh', 'node_modules', '.bin'),
          join(runtimeRoot, runtimeLayout.nodeBinDirectory),
        ],
        workspaceRoot,
        version: '0.1.0-rc.8',
        startupTimeoutMs: 20_000,
        shutdownTimeoutMs: 5_000,
        createCompanionToken: () => 'fixture-token-that-is-long-enough-1234567890',
        onOutput: (stream, chunk) => runtimeOutput.push(`[${stream}] ${chunk}`),
      });

      const ready = await supervisor.start().catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n${runtimeOutput.join('')}`,
        );
      });
      expect(ready).toMatchObject({
        kind: 'ready',
        version: '0.1.0-rc.8',
      });
      await bootstrap.commit(staged.profileGeneration);
    },
    30_000,
  );

  it('provides pnpm to the official plugin command without a global install', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-plugin-home-'));
    const runtimeRoot = join(projectRoot, 'resources', 'runtime');
    const runtimeLayout = resolveBundledRuntimePlatform(process.platform, process.arch);
    const node = join(runtimeRoot, runtimeLayout.nodeExecutable);
    const dsh = join(
      runtimeRoot,
      'dsh',
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'lib',
      'bin.js',
    );
    const runtimePath = [
      join(runtimeRoot, 'dsh', 'node_modules', '.bin'),
      join(runtimeRoot, runtimeLayout.nodeBinDirectory),
      process.env.PATH,
    ]
      .filter((entry): entry is string => entry !== undefined)
      .join(delimiter);

    const result = await execFileAsync(
      node,
      [dsh, 'plugin', '--profile', 'web', '--version'],
      {
        env: { DSH_HOME: runtimeHome, PATH: runtimePath },
        timeout: 20_000,
      },
    );

    expect(result.stdout.trim()).toBe('10.34.5');
  });
});
