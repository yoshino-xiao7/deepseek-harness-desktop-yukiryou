import { describe, expect, it, vi } from 'vitest';
import { restoreWindowBounds } from './restore-window-bounds.js';

describe('restoreWindowBounds', () => {
  const saved = { x: 80, y: 60, width: 1062, height: 697 };

  it('corrects native inset drift without accumulating size across restarts', () => {
    for (let restart = 0; restart < 3; restart++) {
      let actual = { ...saved, width: saved.width + 6, height: saved.height + 3 };
      const window = {
        getBounds: () => actual,
        setBounds: vi.fn((request: typeof saved) => {
          actual = { ...request, width: request.width + 2, height: request.height + 1 };
        }),
      };
      restoreWindowBounds(window, saved, 'win32');
      expect(actual).toEqual(saved);
      expect(window.setBounds).toHaveBeenCalledTimes(2);
    }
  });

  it('does not adjust an exact native rectangle again', () => {
    const window = { getBounds: () => saved, setBounds: vi.fn() };
    restoreWindowBounds(window, saved, 'win32');
    expect(window.setBounds).toHaveBeenCalledExactlyOnceWith(saved);
  });

  it('bounds retries when the native window refuses a rectangle', () => {
    const window = { getBounds: () => ({ ...saved, width: 1200 }), setBounds: vi.fn() };
    restoreWindowBounds(window, saved, 'win32');
    expect(window.setBounds).toHaveBeenCalledTimes(4);
  });

  it('preserves macOS constructor restoration', () => {
    const window = { getBounds: vi.fn(), setBounds: vi.fn() };
    restoreWindowBounds(window, saved, 'darwin');
    expect(window.setBounds).not.toHaveBeenCalled();
    expect(window.getBounds).not.toHaveBeenCalled();
  });
});
