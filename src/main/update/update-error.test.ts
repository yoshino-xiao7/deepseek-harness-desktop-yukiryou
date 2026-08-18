import { describe, expect, it } from 'vitest';

import { updateRecoveryForError } from './update-error.js';

describe('update error recovery', () => {
  it('requires a manual download when macOS cannot validate the downloaded app', () => {
    expect(
      updateRecoveryForError(
        new Error('Code signature at URL file:///tmp/App.app did not pass validation'),
      ),
    ).toBe('manual-download');
    expect(
      updateRecoveryForError(new Error('代码未能满足指定的代码要求')),
    ).toBe('manual-download');
  });

  it('keeps ordinary network failures retryable', () => {
    expect(updateRecoveryForError(new Error('The network connection was lost')))
      .toBe('retry');
  });
});
