import { describe, expect, it } from 'vitest';

import {
  RC8_DESKTOP_SLOT_CONTRACT,
  runtimeSlotContract,
} from './runtime-slot-contract.js';

describe('rc.8 desktop slot contract', () => {
  it('locks the root ownership tree instead of guessing from slot names', () => {
    const root = runtimeSlotContract('root');
    expect(root).toMatchObject({
      kind: 'single',
      scope: 'root',
      occupant: ['client-ui-layout AppFrame'],
      replaceRisk: 'shadows-shipped-ui',
    });
    expect(root.childSlots).toEqual([
      'sidebar',
      'conversation',
      'details',
      'shell.overlay',
    ]);
  });

  it.each([
    'sidebar',
    'conversation',
    'details',
    'conversation.details.tool',
  ])('%s is a destructive replacement seam', (key) => {
    expect(runtimeSlotContract(key)).toMatchObject({
      kind: 'single',
      replaceRisk: 'shadows-shipped-ui',
    });
  });

  it.each([
    'shell.overlay',
    'settings.section',
    'sidebar.footer.action',
    'conversation.chat.turnTail',
  ])('%s remains additive for business plugins', (key) => {
    expect(runtimeSlotContract(key)).toMatchObject({
      replaceRisk: 'none',
    });
  });

  it('keeps every declared child addressable by the fixed contract', () => {
    const keys = new Set(RC8_DESKTOP_SLOT_CONTRACT.map((entry) => entry.key));
    expect(keys).toEqual(
      new Set([
        'root',
        'sidebar',
        'conversation',
        'details',
        'shell.overlay',
        'conversation.details.tool',
        'settings.section',
        'sidebar.footer.action',
        'conversation.chat.turnTail',
      ]),
    );
    expect(() => runtimeSlotContract('conversation.input.left')).toThrow(
      'Unknown rc.8 desktop slot',
    );
  });
});
