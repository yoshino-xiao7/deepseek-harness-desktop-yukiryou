import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createRuntimeSupervisor,
  type RuntimeSupervisor,
} from '../../src/main/runtime/runtime-supervisor.js';
import { createHarnessRuntimeCommand } from '../../src/main/runtime/runtime-command.js';
import { ensureDesktopSettingsExtension } from '../../src/main/runtime/runtime-extension.js';

const projectRoot = process.cwd();
const execFileAsync = promisify(execFile);

describe('bundled Harness runtime', () => {
  let supervisor: RuntimeSupervisor | undefined;

  afterEach(async () => {
    await supervisor?.stop('quit');
  });

  it(
    'serves the official Harness UI from an isolated Runtime Home',
    async () => {
      const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-real-home-'));
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-real-workspace-'));
      const runtimeRoot = join(projectRoot, 'resources', 'runtime');
      await ensureDesktopSettingsExtension(runtimeHome, runtimeRoot);
      const runtimeCommand = createHarnessRuntimeCommand(runtimeRoot);
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
      expect(dshVersion.stdout.trim()).toBe('0.1.0-rc.7');
      supervisor = createRuntimeSupervisor({
        command: runtimeCommand.command,
        args: runtimeCommand.args,
        runtimeHome,
        runtimeBinDirectories: [
          join(runtimeRoot, 'dsh', 'node_modules', '.bin'),
          join(runtimeRoot, 'node', 'bin'),
        ],
        workspaceRoot,
        version: '0.1.0-rc.7',
        startupTimeoutMs: 20_000,
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
    30_000,
  );

  it('provides pnpm to the official plugin command without a global install', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-plugin-home-'));
    const runtimeRoot = join(projectRoot, 'resources', 'runtime');
    const node = join(runtimeRoot, 'node', 'bin', 'node');
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
      join(runtimeRoot, 'node', 'bin'),
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
