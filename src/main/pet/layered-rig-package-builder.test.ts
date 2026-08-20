import { describe, expect, it } from 'vitest';

import { validLayeredRigManifest } from '../../shared/pet-layered-rig-test-fixture.js';
import { createPngHeader } from './pet-package-test-helper.js';
import { prepareLayeredRigRuntimeCandidate, preflightPetPackage } from './pet-package-preflight.js';
import { buildLayeredRigPetPackage } from './layered-rig-package-builder.js';

function build(partWidth = 64) {
  return buildLayeredRigPetPackage({
    id: 'yukiryou.test-pet',
    displayName: { 'zh-CN': '测试宠物', en: 'Test Pet' },
    author: 'YukiRyou', license: 'private-original', source: 'local-generated',
    thumbnail: { mediaType: 'image/png', bytes: createPngHeader({ width: 256, height: 256 }) },
    rig: validLayeredRigManifest(),
    parts: new Map([['body', { mediaType: 'image/png', bytes: createPngHeader({ width: partWidth, height: 96 }) }]]),
  });
}

describe('layered rig package builder', () => {
  it('creates an importable package that prepares into the isolated player format', async () => {
    const archive = build();
    await expect(preflightPetPackage(archive)).resolves.toMatchObject({ status: 'accepted', package: { id: 'yukiryou.test-pet' } });
    await expect(prepareLayeredRigRuntimeCandidate(archive)).resolves.toMatchObject({
      status: 'accepted', candidate: { runtime: 'layered-rig-canvas2d' },
    });
  });

  it('rejects part dimensions that do not match the validated declaration', () => {
    expect(() => build(63)).toThrow('dimensions mismatch');
  });
});
