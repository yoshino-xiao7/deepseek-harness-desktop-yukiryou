import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import type { PetAuthoringProgressSnapshot } from '../../shared/pet-authoring.js';

export interface PetAuthoringAdapterProgress {
  mainLookReady(): void;
  motionReady(motion: PetMotion): void;
  visualQaStarted(): void;
}

export type PetAuthoringProgressListener = (snapshot: PetAuthoringProgressSnapshot) => void;

export class PetAuthoringProgressTracker implements PetAuthoringAdapterProgress {
  readonly #completedMotions = new Set<PetMotion>();
  readonly #listener: PetAuthoringProgressListener | undefined;
  #sequence = 0;
  #stage: PetAuthoringProgressSnapshot['stage'] = 'preparing';
  #percent = 0;
  #terminal = false;

  constructor(listener?: PetAuthoringProgressListener) {
    this.#listener = listener;
    this.#emit('running');
  }

  prepared(): void {
    this.#advance('preparing', 10);
  }

  mainLookReady(): void {
    this.#advance('main-look', 25);
  }

  motionReady(motion: PetMotion): void {
    if (this.#terminal || this.#percent >= 82 || !PET_MOTIONS.includes(motion) || this.#completedMotions.has(motion)) return;
    this.mainLookReady();
    this.#completedMotions.add(motion);
    const percent = 25 + Math.round((this.#completedMotions.size / PET_MOTIONS.length) * 50);
    this.#advance('motions', percent);
  }

  visualQaStarted(): void {
    this.#advance('hatching', 82);
  }

  packagingStarted(): void {
    this.#advance('hatching', 92);
  }

  complete(): void {
    if (this.#terminal) return;
    this.#stage = 'hatching';
    this.#percent = 100;
    this.#terminal = true;
    this.#emit('complete');
  }

  finish(status: 'failed' | 'cancelled'): void {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#emit(status);
  }

  #advance(stage: PetAuthoringProgressSnapshot['stage'], percent: number): void {
    if (this.#terminal || percent <= this.#percent) return;
    this.#stage = stage;
    this.#percent = percent;
    this.#emit('running');
  }

  #emit(status: PetAuthoringProgressSnapshot['status']): void {
    if (this.#listener === undefined) return;
    const completedMotions = PET_MOTIONS.filter((motion) => this.#completedMotions.has(motion));
    const snapshot: PetAuthoringProgressSnapshot = Object.freeze({
      schemaVersion: 1,
      sequence: this.#sequence++,
      status,
      stage: this.#stage,
      percent: this.#percent,
      completedMotions: Object.freeze(completedMotions),
      totalMotions: PET_MOTIONS.length,
    });
    try {
      this.#listener(snapshot);
    } catch {
      // Progress is observational and must never alter authoring output.
    }
  }
}
