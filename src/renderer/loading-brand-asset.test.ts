import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { rendererPublicDirectory } from '../../vite.renderer.config.js';

describe('loading brand asset', () => {
  it('maps the loading image URL to a real PNG in the Vite public directory', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    const source = html.match(/class="brand-image"[\s\S]*?src="([^"]+)"/)?.[1];

    expect(source).toMatch(/^\/[A-Za-z0-9._-]+\.png$/);

    const image = await readFile(join(rendererPublicDirectory, source!.slice(1)));
    expect(image.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
