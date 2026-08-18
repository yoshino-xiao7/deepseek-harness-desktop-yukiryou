export type ArchiveKind = 'zip' | 'dmg';

export interface DistributionVerificationPolicy {
  readonly requireArchiveTicket: boolean;
  readonly requireInstalledAppGatekeeper: boolean;
  readonly requireInstalledAppTicket: boolean;
}

export function distributionVerificationPolicy(
  kind: ArchiveKind,
  requireNotarized: boolean,
): DistributionVerificationPolicy {
  return {
    requireArchiveTicket: requireNotarized && kind === 'dmg',
    requireInstalledAppGatekeeper: requireNotarized,
    requireInstalledAppTicket: requireNotarized && kind === 'zip',
  };
}
