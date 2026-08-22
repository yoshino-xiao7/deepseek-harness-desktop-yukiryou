export type PluginProfileRestartKind = 'application' | 'runtime';

/**
 * Forge owns the development renderer server. Relaunching Electron tears down
 * Forge and leaves the new process pointing at a dead localhost URL, so only a
 * packaged application may use a full-process relaunch here.
 */
export function pluginProfileRestartKind(isPackaged: boolean): PluginProfileRestartKind {
  return isPackaged ? 'application' : 'runtime';
}
