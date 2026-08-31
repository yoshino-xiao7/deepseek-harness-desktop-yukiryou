export const UPDATE_COMMAND_CHANNEL = 'dsh-desktop:update-command';
export const UPDATE_STATE_CHANNEL = 'dsh-desktop:update-state';

export type UpdateCommand = 'check' | 'install' | 'download';

export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'latest'
  | 'downloading'
  | 'downloaded'
  | 'manual'
  | 'error';

export interface DesktopUpdateState {
  readonly status: UpdateStatus;
  readonly currentVersion: string;
  readonly downloadPercent?: number;
  readonly releaseName?: string;
  readonly releaseNotes?: string;
  readonly checkedAt?: string;
  readonly message?: string;
}

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

export function validatedUpdateCommand(value: unknown): UpdateCommand | undefined {
  return value === 'check' || value === 'install' || value === 'download'
    ? value
    : undefined;
}

export function shouldShowHeaderUpdate(state: DesktopUpdateState): boolean {
  return state.status !== 'disabled' && state.status !== 'latest';
}

export function validatedUpdateState(
  value: unknown,
): DesktopUpdateState | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const statuses: readonly UpdateStatus[] = [
    'disabled',
    'idle',
    'checking',
    'latest',
    'downloading',
    'downloaded',
    'manual',
    'error',
  ];
  if (
    !statuses.includes(candidate.status as UpdateStatus) ||
    typeof candidate.currentVersion !== 'string' ||
    !VERSION.test(candidate.currentVersion)
  ) {
    return undefined;
  }
  const state: DesktopUpdateState = {
    status: candidate.status as UpdateStatus,
    currentVersion: candidate.currentVersion,
  };
  if (candidate.downloadPercent !== undefined) {
    if (
      candidate.status !== 'downloading' ||
      typeof candidate.downloadPercent !== 'number' ||
      !Number.isFinite(candidate.downloadPercent) ||
      candidate.downloadPercent < 0 ||
      candidate.downloadPercent > 100
    ) {
      return undefined;
    }
    Object.assign(state, { downloadPercent: candidate.downloadPercent });
  }
  if (typeof candidate.releaseName === 'string') {
    if (candidate.releaseName.length > 80) return undefined;
    Object.assign(state, { releaseName: candidate.releaseName });
  }
  if (typeof candidate.releaseNotes === 'string') {
    if (candidate.releaseNotes.length > 2_000) return undefined;
    Object.assign(state, { releaseNotes: candidate.releaseNotes });
  }
  if (typeof candidate.checkedAt === 'string') {
    if (candidate.checkedAt.length > 40) return undefined;
    Object.assign(state, { checkedAt: candidate.checkedAt });
  }
  if (typeof candidate.message === 'string') {
    if (candidate.message.length > 240) return undefined;
    Object.assign(state, { message: candidate.message });
  }
  return state;
}
