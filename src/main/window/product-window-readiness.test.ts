import { describe, expect, it } from 'vitest';

import type { DesktopFrameHealth } from '../../shared/desktop-frame-health.js';
import { createProductWindowReadiness } from './product-window-readiness.js';
import { createTrustedHarnessOrigin } from './trusted-navigation.js';

const origin = createTrustedHarnessOrigin('http://127.0.0.1:51234');
const health: DesktopFrameHealth = {
  protocolVersion: 1,
  status: 'ready',
  capabilities: {
    integratedChrome: true,
    resizablePanels: true,
    shellOverlay: true,
  },
};

describe('product window readiness', () => {
  it('keeps the Legacy carrier compatible with document-only readiness', () => {
    const readiness = createProductWindowReadiness('legacy');
    expect(readiness.begin(origin)).toEqual({ kind: 'loading', origin });
    expect(readiness.documentLoaded()).toEqual({ kind: 'ready', origin });
  });

  it.each(['document-first', 'health-first'] as const)(
    'requires both Integrated signals in %s order',
    (order) => {
      const readiness = createProductWindowReadiness('integrated');
      readiness.begin(origin);
      const first = order === 'document-first'
        ? readiness.documentLoaded()
        : readiness.acceptFrameHealth(health);
      expect(first).toEqual({ kind: 'loading', origin });
      const second = order === 'document-first'
        ? readiness.acceptFrameHealth(health)
        : readiness.documentLoaded();
      expect(second).toEqual({ kind: 'ready', origin });
    },
  );

  it('fails closed when the Frame reports an incompatible contract', () => {
    const readiness = createProductWindowReadiness('integrated');
    readiness.begin(origin);
    expect(
      readiness.acceptFrameHealth({
        ...health,
        status: 'incompatible',
        reason: 'root ownership changed',
      }),
    ).toEqual({ kind: 'crashed', reason: 'root ownership changed' });
  });

  it('drops stale readiness signals after hide and a new load', () => {
    const readiness = createProductWindowReadiness('integrated');
    readiness.begin(origin);
    readiness.acceptFrameHealth(health);
    readiness.hide();
    readiness.begin(origin);
    expect(readiness.documentLoaded()).toEqual({ kind: 'loading', origin });
  });
});
