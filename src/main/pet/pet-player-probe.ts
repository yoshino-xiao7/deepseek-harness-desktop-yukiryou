import type { PetPlayerRealm } from './pet-player-realm.js';
import type { PetRuntimeProbe } from './pet-runtime-validator.js';

export function createPetPlayerProbe(createRealm: () => PetPlayerRealm): PetRuntimeProbe {
  let realm: PetPlayerRealm | undefined;
  let used = false;
  let disposed = false;
  return {
    async validate(candidate): Promise<'compatible' | 'incompatible'> {
      if (used || disposed) return 'incompatible';
      used = true;
      const active = createRealm();
      realm = active;
      try {
        await active.start({ petGeneration: 1, ...candidate });
        return !disposed && realm === active ? 'compatible' : 'incompatible';
      } catch {
        return 'incompatible';
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      realm?.dispose();
      realm = undefined;
    },
  };
}
