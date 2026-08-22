/** Keeps the local install fixture out of every packaged application. */
export function developmentPluginFixtureEnabled(isPackaged: boolean): boolean {
  return !isPackaged;
}
