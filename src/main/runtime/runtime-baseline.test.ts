import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface RuntimeSourceManifest {
  readonly schemaVersion: number;
  readonly node: {
    readonly archives: Record<string, {
      readonly file: string;
      readonly sha256: string;
    }>;
  };
  readonly dsh: { readonly version: string; readonly integrity: string };
}

interface RuntimePackageJson {
  readonly dependencies: Record<string, string>;
  readonly allowScripts: Record<string, boolean>;
}

interface LockedPackage {
  readonly version?: string;
  readonly integrity?: string;
  readonly hasInstallScript?: boolean;
  readonly dependencies?: Record<string, string>;
}

interface RuntimePackageLock {
  readonly packages: Record<string, LockedPackage>;
}

const projectRoot = process.cwd();

describe('bundled Runtime baseline', () => {
  it('keeps the manifest, dependency lock and install-script allowlist aligned', async () => {
    const [manifest, packageJson, packageLock] = await Promise.all([
      readJson<RuntimeSourceManifest>('runtime/manifest.json'),
      readJson<RuntimePackageJson>('runtime/package.json'),
      readJson<RuntimePackageLock>('runtime/package-lock.json'),
    ]);

    const root = requiredLockedPackage(packageLock, '');
    const dsh = requiredLockedPackage(
      packageLock,
      'node_modules/@deepseek-ai/dsh',
    );
    expect(packageJson.dependencies['@deepseek-ai/dsh']).toBe(
      manifest.dsh.version,
    );
    expect(root.dependencies?.['@deepseek-ai/dsh']).toBe(manifest.dsh.version);
    expect(dsh.version).toBe(manifest.dsh.version);
    expect(dsh.integrity).toBe(manifest.dsh.integrity);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.node.archives).toMatchObject({
      'darwin-arm64': {
        file: 'node-v24.19.0-darwin-arm64.tar.xz',
        sha256: '3f1cf157479c1480352083105e13faf9d008ede98e7e157746b6df940d197b94',
      },
      'win32-x64': {
        file: 'node-v24.19.0-win-x64.zip',
        sha256: '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73',
      },
    });

    const deepSeekVersions = new Set(
      Object.entries(packageLock.packages)
        .filter(([name]) =>
          /^node_modules\/@deepseek-ai\/dsh(?:$|-[^/]+$)/u.test(name),
        )
        .map(([, locked]) => locked.version)
        .filter((version): version is string => version !== undefined),
    );
    expect(deepSeekVersions).toEqual(new Set([manifest.dsh.version]));

    const subprocess = requiredLockedPackage(
      packageLock,
      'node_modules/@deepseek-ai/dsh-subprocess-local',
    );
    const nodePty = requiredLockedPackage(packageLock, 'node_modules/node-pty');
    expect(subprocess.dependencies?.['node-pty']).toBe(nodePty.version);

    const allowedScripts = Object.entries(packageJson.allowScripts)
      .filter(([, allowed]) => allowed)
      .map(([name]) => name)
      .sort();
    const installScripts = Object.entries(packageLock.packages)
      .filter(([, locked]) => locked.hasInstallScript)
      .map(([name, locked]) => `${packageName(name)}@${locked.version ?? ''}`)
      .sort();
    expect(allowedScripts).toEqual(installScripts);
  });
});

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(
    await readFile(join(projectRoot, relativePath), 'utf8'),
  ) as T;
}

function requiredLockedPackage(
  lock: RuntimePackageLock,
  name: string,
): LockedPackage {
  const locked = lock.packages[name];
  if (locked === undefined) {
    throw new Error(`Missing locked Runtime package: ${name || '<root>'}`);
  }
  return locked;
}

function packageName(lockPath: string): string {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  if (index === -1) {
    throw new Error(
      `Install-script package is outside node_modules: ${lockPath}`,
    );
  }
  return lockPath.slice(index + marker.length);
}
