import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Electron package contract', () => {
  it('uses an explicit CommonJS extension for the main process bundle', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { main?: string; type?: string };

    expect(packageJson.type).toBe('module');
    expect(packageJson.main).toBe('.vite/build/main-entry.cjs');
  });
});
