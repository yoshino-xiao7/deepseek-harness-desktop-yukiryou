import { redact } from '../diagnostics/app-log.js';

const DEFAULT_MAX_BUFFERED_CHARACTERS = 8_192;
const MAX_RETAINED_COMPANION_SECRETS = 8;
const OVERSIZED_LINE_MARKER = '[OMITTED_OVERSIZED_RUNTIME_STDERR_LINE]';
const COMPANION_SECRET_MARKER = '[REDACTED_COMPANION_SECRET]';

export interface RuntimeStderrScrubberOptions {
  readonly onLine: (line: string) => void;
  readonly maxBufferedCharacters?: number;
}

export interface RuntimeStderrScrubber {
  write(chunk: string): void;
  flush(): void;
  rotateCompanionSecret(secret: string): void;
}

class BoundedRuntimeStderrScrubber implements RuntimeStderrScrubber {
  readonly #onLine: (line: string) => void;
  readonly #maxBufferedCharacters: number;
  #buffer = '';
  #oversized = false;
  #companionSecrets: string[] = [];

  constructor(options: RuntimeStderrScrubberOptions) {
    const maxBufferedCharacters =
      options.maxBufferedCharacters ?? DEFAULT_MAX_BUFFERED_CHARACTERS;
    if (!Number.isSafeInteger(maxBufferedCharacters) || maxBufferedCharacters < 1) {
      throw new RangeError('maxBufferedCharacters must be a positive integer');
    }
    this.#onLine = options.onLine;
    this.#maxBufferedCharacters = maxBufferedCharacters;
  }

  rotateCompanionSecret(secret: string): void {
    // Finish data from the previous Runtime while its exact secret is still
    // available. Keep a small bounded history for stderr delivered late by a
    // recently exited child's pipe during rapid restart cycles.
    this.flush();
    if (secret === '') return;
    this.#companionSecrets = [
      secret,
      ...this.#companionSecrets.filter((value) => value !== secret),
    ].slice(0, MAX_RETAINED_COMPANION_SECRETS);
  }

  write(chunk: string): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf('\n', offset);
      const segmentEnd = newline === -1 ? chunk.length : newline;
      this.#appendSegment(chunk.slice(offset, segmentEnd));
      if (newline === -1) return;
      this.#emitBufferedLine();
      offset = newline + 1;
    }
  }

  flush(): void {
    if (this.#buffer === '' && !this.#oversized) return;
    this.#emitBufferedLine();
  }

  #appendSegment(segment: string): void {
    if (this.#oversized || segment === '') return;
    const remaining = this.#maxBufferedCharacters - this.#buffer.length;
    if (segment.length <= remaining) {
      this.#buffer += segment;
      return;
    }

    // Never emit a prefix of an oversized line. A secret could straddle the
    // boundary, so emitting independently scrubbed pieces would leak it.
    this.#buffer = '';
    this.#oversized = true;
  }

  #emitBufferedLine(): void {
    if (this.#oversized) {
      this.#onLine(OVERSIZED_LINE_MARKER);
    } else {
      const line = this.#buffer.endsWith('\r')
        ? this.#buffer.slice(0, -1)
        : this.#buffer;
      this.#onLine(this.#scrub(line));
    }
    this.#buffer = '';
    this.#oversized = false;
  }

  #scrub(line: string): string {
    let scrubbed = line;
    for (const secret of this.#companionSecrets) {
      scrubbed = scrubbed.replaceAll(secret, COMPANION_SECRET_MARKER);
    }
    return redact(scrubbed);
  }
}

export function createRuntimeStderrScrubber(
  options: RuntimeStderrScrubberOptions,
): RuntimeStderrScrubber {
  return new BoundedRuntimeStderrScrubber(options);
}
