import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPetStateDirector } from './pet-state-director.js';

describe('pet state director', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('moves naturally from standing through drowsy and lying-down into sleep', () => {
    const states: string[] = [];
    const director = createPetStateDirector({ onStateChange: (state) => states.push(state), idleBeforeDrowsyMs: 100 });
    director.update({ visible: true, running: false });
    vi.advanceTimersByTime(100 + 1_800 + 1_900);
    expect(states).toEqual(['drowsy', 'lying-down', 'sleeping']);
  });

  it('wakes a sleeping pet through waking and rubbing-eyes before standing', () => {
    const states: string[] = [];
    const director = createPetStateDirector({ onStateChange: (state) => states.push(state), idleBeforeDrowsyMs: 100 });
    director.update({ visible: true, running: false });
    vi.advanceTimersByTime(3_800);
    director.wake();
    vi.advanceTimersByTime(2_100 + 1_500);
    expect(states.slice(-3)).toEqual(['waking', 'rubbing-eyes', 'standing']);
  });

  it('enters and exits eating with authored transitions when work starts and stops', () => {
    const states: string[] = [];
    const director = createPetStateDirector({ onStateChange: (state) => states.push(state) });
    director.update({ visible: true, running: false });
    director.update({ visible: true, running: true });
    vi.advanceTimersByTime(1_000);
    director.update({ visible: true, running: false });
    vi.advanceTimersByTime(1_000);
    expect(states).toEqual(['work-enter', 'eating', 'work-exit', 'standing']);
  });

  it('cancels idle work while hidden and restarts from standing when shown', () => {
    const states: string[] = [];
    const director = createPetStateDirector({ onStateChange: (state) => states.push(state), idleBeforeDrowsyMs: 100 });
    director.update({ visible: true, running: false });
    director.update({ visible: false, running: false });
    vi.advanceTimersByTime(10_000);
    expect(director.getState()).toBe('standing');
    expect(states).toEqual([]);
  });
});
