import type { Rectangle } from 'electron';

import type {
  PetPlayerAsset,
  PetPlayerPresentation,
  PetPlayerRealm,
} from './pet-player-realm.js';
import { createPetStateDirector } from './pet-state-director.js';

export interface PetPlayerSelection {
  readonly id: string;
  readonly runtime: PetPlayerAsset['runtime'];
  readonly assetSha256: string;
  readonly assetBytes: ArrayBuffer;
}

export interface PetPlayerStagePresentation {
  readonly bounds: Rectangle;
  readonly visible: boolean;
  readonly running: boolean;
  readonly reducedMotion: boolean;
  readonly devicePixelRatio: number;
}

export interface PetPlayerHost {
  select(selection?: PetPlayerSelection): Promise<'ready' | 'unavailable'>;
  present(presentation?: PetPlayerStagePresentation): void;
  wake(): void;
  dispose(): void;
}

export function createPetPlayerHost(createRealm: () => PetPlayerRealm): PetPlayerHost {
  let disposed = false;
  let selectionKey: string | undefined;
  let selectionPromise: Promise<'ready' | 'unavailable'> | undefined;
  let realm: PetPlayerRealm | undefined;
  let petGeneration = 0;
  let presentationGeneration = 0;
  let lastPresentation: PetPlayerStagePresentation | undefined;
  const director = createPetStateDirector({
    onStateChange: () => presentCurrent(realm, lastPresentation),
  });

  return {
    select(selection): Promise<'ready' | 'unavailable'> {
      if (disposed) return Promise.resolve('unavailable');
      const nextKey = selection === undefined ? undefined : `${selection.id}:${selection.runtime}:${selection.assetSha256}`;
      if (nextKey === selectionKey && selectionPromise !== undefined) return selectionPromise;
      const previous = realm;
      realm = undefined;
      selectionKey = nextKey;
      selectionPromise = undefined;
      previous?.dispose();
      director.reset();
      if (selection === undefined) return Promise.resolve('unavailable');
      director.update({
        visible: lastPresentation?.visible === true,
        running: lastPresentation?.running === true,
      });

      const generation = ++petGeneration;
      const candidate = createRealm();
      realm = candidate;
      const startup = (async (): Promise<'ready' | 'unavailable'> => {
        try {
          await candidate.start({
            petGeneration: generation,
            runtime: selection.runtime,
            assetSha256: selection.assetSha256,
            assetBytes: selection.assetBytes,
          });
        } catch {
          candidate.dispose();
          if (realm === candidate) {
            realm = undefined;
            selectionKey = undefined;
          }
          return 'unavailable';
        }
        if (disposed || realm !== candidate) {
          candidate.dispose();
          return 'unavailable';
        }
        presentCurrent(candidate, lastPresentation);
        return 'ready';
      })();
      selectionPromise = startup;
      return startup;
    },
    present(presentation): void {
      lastPresentation = presentation;
      director.update({
        visible: presentation?.visible === true,
        running: presentation?.running === true,
      });
      presentCurrent(realm, presentation);
    },
    wake(): void {
      director.wake();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      selectionKey = undefined;
      selectionPromise = undefined;
      lastPresentation = undefined;
      director.dispose();
      realm?.dispose();
      realm = undefined;
    },
  };

  function presentCurrent(
    target: PetPlayerRealm | undefined,
    presentation: PetPlayerStagePresentation | undefined,
  ): void {
    if (target === undefined || presentation === undefined || !presentation.visible) {
      target?.present();
      return;
    }
    const output: PetPlayerPresentation = {
      bounds: presentation.bounds,
      petGeneration,
      presentationGeneration: ++presentationGeneration,
      state: director.getState(),
      reducedMotion: presentation.reducedMotion,
      devicePixelRatio: presentation.devicePixelRatio,
    };
    target.present(output);
  }
}
