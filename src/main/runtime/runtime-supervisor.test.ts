import type { ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { terminateWindowsProcessTree } from './runtime-supervisor.js';

describe('Windows Runtime process-tree termination', () => {
  it('uses the OS process-tree primitive while the root PID is available', () => {
    const runTaskkill = vi.fn().mockReturnValue({ status: 0 });

    const result = terminateWindowsProcessTree(
      { pid: 4242, exitCode: null } as ChildProcess,
      {
        platform: 'win32',
        systemRoot: 'C:\\Windows',
        runTaskkill,
      },
    );

    expect(runTaskkill).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4242', '/T', '/F'],
    );
    expect(result).toEqual({ started: true, detail: 'taskkill-exit-0' });
  });

  it('reports a nonzero taskkill result instead of pretending cleanup succeeded', () => {
    expect(terminateWindowsProcessTree(
      { pid: 4242, exitCode: null } as ChildProcess,
      {
        platform: 'win32',
        runTaskkill: () => ({ status: 1 }),
      },
    )).toEqual({ started: false, detail: 'taskkill-exit-1' });
  });

  it('does nothing on non-Windows platforms', () => {
    const runTaskkill = vi.fn();

    expect(terminateWindowsProcessTree(
      { pid: 4242, exitCode: null } as ChildProcess,
      { platform: 'darwin', runTaskkill },
    )).toEqual({ started: false, detail: 'not-windows' });
    expect(runTaskkill).not.toHaveBeenCalled();
  });
});
