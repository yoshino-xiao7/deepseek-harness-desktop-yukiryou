import { describe, expect, it, vi } from 'vitest';

import { createRuntimeStderrScrubber } from './runtime-stderr-scrubber.js';

describe('RuntimeStderrScrubber', () => {
  it('redacts the Companion assignment and the actual secret across chunks', () => {
    const secret = 'runtime-companion-secret-that-must-never-reach-the-log';
    const onLine = vi.fn();
    const scrubber = createRuntimeStderrScrubber({ onLine });
    scrubber.rotateCompanionSecret(secret);

    scrubber.write('DSH_DESKTOP_COMPANION_TOKEN=runtime-companion-');
    scrubber.write('secret-that-must-never-reach-the-log\nprinted: runtime-companion-secret-');
    scrubber.write('that-must-never-reach-the-log\n');

    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine.mock.calls.flat().join('\n')).not.toContain(secret);
    expect(onLine).toHaveBeenNthCalledWith(
      1,
      'DSH_DESKTOP_COMPANION_TOKEN=[REDACTED]',
    );
    expect(onLine).toHaveBeenNthCalledWith(
      2,
      'printed: [REDACTED_COMPANION_SECRET]',
    );
  });

  it('omits an oversized line instead of exposing a secret at the buffer boundary', () => {
    const secret = 'boundary-secret';
    const onLine = vi.fn();
    const scrubber = createRuntimeStderrScrubber({
      maxBufferedCharacters: 16,
      onLine,
    });
    scrubber.rotateCompanionSecret(secret);

    scrubber.write('123456789boundar');
    scrubber.write('y-secret-without-newline');
    scrubber.flush();

    expect(onLine).toHaveBeenCalledOnce();
    expect(onLine).toHaveBeenCalledWith(
      '[OMITTED_OVERSIZED_RUNTIME_STDERR_LINE]',
    );
    expect(onLine.mock.calls.flat().join('')).not.toContain('boundary');
    expect(onLine.mock.calls.flat().join('')).not.toContain('secret');
  });

  it('preserves normal stderr lines and flushes the final unterminated line', () => {
    const onLine = vi.fn();
    const scrubber = createRuntimeStderrScrubber({ onLine });

    scrubber.write('first line\nsecond');
    expect(onLine).toHaveBeenCalledOnce();
    expect(onLine).toHaveBeenCalledWith('first line');

    scrubber.flush();
    scrubber.flush();
    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenNthCalledWith(2, 'second');
  });

  it('flushes buffered output with the old secret before rotating', () => {
    const oldSecret = 'old-runtime-companion-secret';
    const onLine = vi.fn();
    const scrubber = createRuntimeStderrScrubber({ onLine });
    scrubber.rotateCompanionSecret(oldSecret);
    scrubber.write(`printed: ${oldSecret}`);

    scrubber.rotateCompanionSecret('new-runtime-companion-secret');

    expect(onLine).toHaveBeenCalledWith(
      'printed: [REDACTED_COMPANION_SECRET]',
    );
  });
});
