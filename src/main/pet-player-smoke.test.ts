import { describe, expect, it } from 'vitest';

import {
  petPlayerSmokeArgument,
  petPlayerSmokePackagePath,
} from './pet-player-smoke.js';

describe('pet player smoke arguments', () => {
  it('requires the exact smoke argument and a non-empty package path', () => {
    expect(petPlayerSmokePackagePath(['app', petPlayerSmokeArgument, '--pet-package=/tmp/pet.yukipet']))
      .toBe('/tmp/pet.yukipet');
    expect(petPlayerSmokePackagePath(['app', '--pet-player-smoke-testing', '--pet-package=/tmp/pet.yukipet']))
      .toBeUndefined();
    expect(petPlayerSmokePackagePath(['app', petPlayerSmokeArgument, '--pet-package=']))
      .toBeUndefined();
  });
});
