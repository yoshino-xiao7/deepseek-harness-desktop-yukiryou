import type { PetSemanticState } from '../../shared/pet-player-protocol.js';

const MOTION_DURATION_MS = Object.freeze({
  drowsy: 1_800,
  'lying-down': 1_900,
  waking: 2_100,
  'rubbing-eyes': 1_500,
  'work-enter': 1_000,
  'work-exit': 1_000,
} satisfies Partial<Record<PetSemanticState, number>>);

interface PetDirectorClock {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface PetStateDirector {
  getState(): PetSemanticState;
  update(input: Readonly<{ visible: boolean; running: boolean }>): void;
  wake(): void;
  reset(): void;
  dispose(): void;
}

export function createPetStateDirector(options: {
  readonly onStateChange: (state: PetSemanticState) => void;
  readonly idleBeforeDrowsyMs?: number;
  readonly clock?: PetDirectorClock;
}): PetStateDirector {
  const clock = options.clock ?? {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
  };
  const idleBeforeDrowsyMs = options.idleBeforeDrowsyMs ?? 45_000;
  let state: PetSemanticState = 'standing';
  let visible = false;
  let running = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    getState: () => state,
    update(input): void {
      if (disposed) return;
      const wasVisible = visible;
      const wasRunning = running;
      visible = input.visible;
      running = input.running;
      if (!visible) {
        cancelTimer();
        change('standing');
        return;
      }
      if (!wasVisible) {
        begin(input.running ? 'work-enter' : 'standing');
        return;
      }
      if (running && !wasRunning) {
        begin('work-enter');
      } else if (!running && wasRunning) {
        begin('work-exit');
      }
    },
    wake(): void {
      if (disposed || !visible || running) return;
      if (state === 'drowsy' || state === 'lying-down' || state === 'sleeping') {
        begin('waking');
      } else if (state === 'standing') {
        schedule(idleBeforeDrowsyMs, () => begin('drowsy'));
      }
    },
    reset(): void {
      if (disposed) return;
      visible = false;
      running = false;
      cancelTimer();
      change('standing');
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelTimer();
    },
  };

  function begin(next: PetSemanticState): void {
    cancelTimer();
    change(next);
    if (!visible) return;
    if (next === 'standing') {
      schedule(idleBeforeDrowsyMs, () => begin(running ? 'work-enter' : 'drowsy'));
    } else if (next === 'drowsy') {
      schedule(MOTION_DURATION_MS.drowsy, () => begin(running ? 'work-enter' : 'lying-down'));
    } else if (next === 'lying-down') {
      schedule(MOTION_DURATION_MS['lying-down'], () => begin(running ? 'work-enter' : 'sleeping'));
    } else if (next === 'waking') {
      schedule(MOTION_DURATION_MS.waking, () => begin(running ? 'work-enter' : 'rubbing-eyes'));
    } else if (next === 'rubbing-eyes') {
      schedule(MOTION_DURATION_MS['rubbing-eyes'], () => begin(running ? 'work-enter' : 'standing'));
    } else if (next === 'work-enter') {
      schedule(MOTION_DURATION_MS['work-enter'], () => begin(running ? 'eating' : 'work-exit'));
    } else if (next === 'work-exit') {
      schedule(MOTION_DURATION_MS['work-exit'], () => begin(running ? 'work-enter' : 'standing'));
    }
  }

  function change(next: PetSemanticState): void {
    if (state === next) return;
    state = next;
    options.onStateChange(state);
  }

  function schedule(delayMs: number, callback: () => void): void {
    cancelTimer();
    timer = clock.setTimeout(() => {
      timer = undefined;
      callback();
    }, delayMs);
  }

  function cancelTimer(): void {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  }
}
