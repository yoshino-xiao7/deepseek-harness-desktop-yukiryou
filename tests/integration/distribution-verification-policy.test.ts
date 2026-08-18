import { describe, expect, it } from 'vitest';

import { distributionVerificationPolicy } from '../../scripts/distribution-verification-policy.js';

describe('distribution verification policy', () => {
  it('requires the app ticket for a notarized ZIP', () => {
    expect(distributionVerificationPolicy('zip', true)).toEqual({
      requireArchiveTicket: false,
      requireInstalledAppGatekeeper: true,
      requireInstalledAppTicket: true,
    });
  });

  it('requires the container ticket, but not an inner app ticket, for a notarized DMG', () => {
    expect(distributionVerificationPolicy('dmg', true)).toEqual({
      requireArchiveTicket: true,
      requireInstalledAppGatekeeper: true,
      requireInstalledAppTicket: false,
    });
  });

  it('does not require notarization checks for a signed candidate', () => {
    expect(distributionVerificationPolicy('zip', false)).toEqual({
      requireArchiveTicket: false,
      requireInstalledAppGatekeeper: false,
      requireInstalledAppTicket: false,
    });
  });
});
