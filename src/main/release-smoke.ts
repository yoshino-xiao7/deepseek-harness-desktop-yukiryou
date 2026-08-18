export const releaseSmokeArgument = '--release-smoke-test';
export const releaseSmokeMarker = 'DEEPSEEK_YUKIRYOU_RELEASE_SMOKE_OK';

export function isReleaseSmokeTest(arguments_: readonly string[]): boolean {
  return arguments_.includes(releaseSmokeArgument);
}
