import { describe, expect, it, vi } from 'vitest';

import { runWhenDocumentReady } from './document-readiness.js';

describe('runWhenDocumentReady', () => {
  it('starts immediately when a cached page completed before preload registration', () => {
    const start = vi.fn();
    const addEventListener = vi.fn();

    runWhenDocumentReady({ readyState: 'complete', addEventListener }, start);

    expect(start).toHaveBeenCalledOnce();
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('waits once while the document is still loading', () => {
    const start = vi.fn();
    const addEventListener = vi.fn();

    runWhenDocumentReady({ readyState: 'loading', addEventListener }, start);

    expect(start).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith('DOMContentLoaded', start, { once: true });
  });
});
