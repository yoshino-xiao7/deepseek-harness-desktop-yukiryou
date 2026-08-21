import { describe, expect, it } from 'vitest';

import { validatedDesktopFrameHealth } from './desktop-frame-health.js';

const capabilities = {
  integratedChrome: true,
  resizablePanels: true,
  shellOverlay: true,
};

describe('desktop frame health wire contract', () => {
  it('accepts the exact ready protocol', () => {
    expect(
      validatedDesktopFrameHealth({
        protocolVersion: 1,
        status: 'ready',
        capabilities,
      }),
    ).toEqual({ protocolVersion: 1, status: 'ready', capabilities });
  });

  it('accepts a bounded incompatible reason', () => {
    expect(
      validatedDesktopFrameHealth({
        protocolVersion: 1,
        status: 'incompatible',
        reason: 'root slot contract changed',
        capabilities,
      }),
    ).toMatchObject({ status: 'incompatible', reason: 'root slot contract changed' });
  });

  it.each([
    undefined,
    { protocolVersion: 2, status: 'ready', capabilities },
    { protocolVersion: 1, status: 'ready', capabilities: {} },
    { protocolVersion: 1, status: 'incompatible', reason: '', capabilities },
    { protocolVersion: 1, status: 'incompatible', reason: 'x'.repeat(241), capabilities },
  ])('rejects malformed or unsupported payloads', (value) => {
    expect(validatedDesktopFrameHealth(value)).toBeUndefined();
  });
});
