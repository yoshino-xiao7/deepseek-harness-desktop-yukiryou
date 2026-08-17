declare const trustedHarnessOriginBrand: unique symbol;

export type TrustedHarnessOrigin = string & {
  readonly [trustedHarnessOriginBrand]: true;
};

export type NavigationDecision = 'allow' | 'open-external' | 'deny';
export type LocalAction = 'retry' | 'open-logs' | 'copy-diagnostics';

export function classifyLocalAction(target: string): LocalAction | undefined {
  try {
    const parsed = new URL(target);
    if (
      parsed.protocol !== 'dsh-desktop:' ||
      parsed.hostname !== 'action' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return undefined;
    }
    const action = parsed.pathname.slice(1);
    return action === 'retry' ||
      action === 'open-logs' ||
      action === 'copy-diagnostics'
      ? action
      : undefined;
  } catch {
    return undefined;
  }
}

export function createTrustedHarnessOrigin(origin: string): TrustedHarnessOrigin {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port === '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new Error('Harness origin must be an authenticated loopback address');
  }
  return parsed.origin as TrustedHarnessOrigin;
}

export function classifyNavigation(
  trustedOrigin: TrustedHarnessOrigin,
  target: string,
): NavigationDecision {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return 'deny';
  }

  if (parsed.origin === trustedOrigin) {
    return 'allow';
  }
  if (parsed.protocol === 'https:') {
    return 'open-external';
  }
  return 'deny';
}
