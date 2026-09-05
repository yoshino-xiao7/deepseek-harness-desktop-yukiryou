import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';

import { createExternalPluginControl } from './external-plugin-control.js';

async function fixture(): Promise<{ runtimeHome: string; packageRoot: string }> {
  const runtimeHome = await mkdtemp(join(tmpdir(), 'external-plugin-control-'));
  const profileRoot = join(runtimeHome, 'profiles', 'web');
  const packageRoot = join(profileRoot, 'node_modules', 'dsh-grok-provider');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(profileRoot, 'package.json'), JSON.stringify({
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'dsh-grok-provider'] } },
    dependencies: { 'dsh-grok-provider': '0.1.1', 'dsh-codex': '0.2.5' },
  }));
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'dsh-grok-provider', version: '0.1.1',
    repository: 'https://github.com/example/dsh-grok-provider',
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }));
  await writeFile(join(packageRoot, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: llm-grok',
    '      name: dsh-grok-provider',
  ].join('\n'));
  return { runtimeHome, packageRoot };
}

describe('external plugin control', () => {
  it('keeps local plugin controls without authorizing a same-name registry update', async () => {
    const { runtimeHome } = await fixture();
    const path = join(runtimeHome, 'profiles', 'web', 'package.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.dependencies['dsh-grok-provider'] = 'file:/tmp/local-plugin';
    await writeFile(path, JSON.stringify(manifest));
    const control = createExternalPluginControl({ runtimeHome, runtimeRoot: '/runtime' });
    expect((await control.inventory())[0]).toMatchObject({ allowedActions: ['disable', 'uninstall'], updateUnavailableReason: 'local-or-unverified-source' });
  });

  it('only grants controls to a direct profile bundle and never to a nested runtime entry', async () => {
    const { runtimeHome } = await fixture();
    const control = createExternalPluginControl({ runtimeHome, runtimeRoot: '/runtime' });

    await expect(control.inventory()).resolves.toEqual([
      {
        packageName: 'dsh-grok-provider',
        version: '0.1.1',
        entryIds: ['llm-grok'],
        enabled: true,
        allowedActions: ['disable', 'uninstall'],
        repository: 'https://github.com/example/dsh-grok-provider',
      },
    ]);
  });

  it('writes a desktop-owned disabling overlay without changing the plugin package', async () => {
    const { runtimeHome, packageRoot } = await fixture();
    const original = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8');
    const control = createExternalPluginControl({ runtimeHome, runtimeRoot: '/runtime' });

    const result = await control.setEnabled({
      packageName: 'dsh-grok-provider', version: '0.1.1', entryId: 'llm-grok', enabled: false,
    });

    expect(result.status).toBe('prepared');
    expect(await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')).toBe(original);
    expect(parse(await readFile(control.overlayPath, 'utf8'))).toEqual([
      { id: 'dsh-grok-provider', disabled: true },
      { id: 'llm-grok', disabled: true },
    ]);
    await expect(control.inventory()).resolves.toMatchObject([{ enabled: false }]);
  });

  it('does not follow a package patch declaration outside that package directory', async () => {
    const { runtimeHome, packageRoot } = await fixture();
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'dsh-grok-provider', version: '0.1.1',
      dsh: { bundle: { patch: '../../outside.patch.yml' } },
    }));
    await writeFile(join(runtimeHome, 'profiles', 'web', 'outside.patch.yml'), [
      '- insert:',
      '    - id: llm-grok',
      '      name: dsh-grok-provider',
    ].join('\n'));

    const control = createExternalPluginControl({ runtimeHome, runtimeRoot: '/runtime' });
    await expect(control.inventory()).resolves.toEqual([]);
  });

  it('revalidates package identity before invoking the official semantic remove command', async () => {
    const { runtimeHome } = await fixture();
    const execute = vi.fn(async () => undefined);
    const control = createExternalPluginControl({
      runtimeHome,
      runtimeRoot: '/runtime',
      execute,
      platform: 'darwin',
      architecture: 'arm64',
    });

    await expect(control.remove({
      packageName: 'dsh-grok-provider', version: '0.1.1', entryId: 'llm-grok',
    })).resolves.toEqual({ status: 'prepared' });
    expect(execute).toHaveBeenCalledWith(
      '/runtime/node/bin/node',
      [
        '/runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
        'plugin', '--profile', 'web', 'remove', 'dsh-grok-provider',
      ],
      expect.objectContaining({ runtimeHome }),
    );
  });

  it('constructs Windows commands with target-native separators and the bundled Node directory', async () => {
    const { runtimeHome } = await fixture();
    const execute = vi.fn(async () => undefined);
    const control = createExternalPluginControl({
      runtimeHome,
      runtimeRoot: 'C:\\runtime',
      execute,
      platform: 'win32',
      architecture: 'x64',
    });

    await control.remove({
      packageName: 'dsh-grok-provider', version: '0.1.1', entryId: 'llm-grok',
    });

    expect(execute).toHaveBeenCalledWith(
      'C:\\runtime\\node\\node.exe',
      expect.arrayContaining(['C:\\runtime\\dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js']),
      expect.objectContaining({
        env: expect.objectContaining({ PATH: expect.stringContaining('C:\\runtime\\node;') }),
      }),
    );
  });

  it('suppresses an exact external package while a managed adoption trials and restores on failure', async () => {
    const { runtimeHome } = await fixture();
    const control = createExternalPluginControl({ runtimeHome, runtimeRoot: '/runtime' });
    const generation = `gen-${'a'.repeat(64)}`;

    await control.prepareAdoption({
      packageName: 'dsh-grok-provider', version: '0.1.1', entryId: 'llm-grok',
    }, generation);

    await expect(control.inventory()).resolves.toMatchObject([{ enabled: false }]);
    await expect(control.reconcileAdoption({
      trialGeneration: generation,
      managedPackageNames: new Set(),
    })).resolves.toBe('kept');
    await control.recoverAdoption(generation);
    await expect(control.inventory()).resolves.toMatchObject([{ enabled: true }]);
  });

  it('removes the old external package only after its managed adoption commits', async () => {
    const { runtimeHome } = await fixture();
    const execute = vi.fn(async () => undefined);
    const control = createExternalPluginControl({
      runtimeHome,
      runtimeRoot: '/runtime',
      execute,
      platform: 'darwin',
      architecture: 'arm64',
    });
    const generation = `gen-${'b'.repeat(64)}`;
    await control.prepareAdoption({
      packageName: 'dsh-grok-provider', version: '0.1.1', entryId: 'llm-grok',
    }, generation);

    await expect(control.commitAdoption(generation)).resolves.toBe('cleaned');
    expect(execute).toHaveBeenCalledWith(
      '/runtime/node/bin/node',
      expect.arrayContaining(['remove', 'dsh-grok-provider']),
      expect.objectContaining({ runtimeHome }),
    );
  });
});
