import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface AppLog {
  write(event: string, details?: string): void;
  close(): Promise<void>;
}

export async function createAppLog(logDirectory: string): Promise<AppLog> {
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  return new FileAppLog(
    createWriteStream(join(logDirectory, 'desktop.log'), {
      flags: 'a',
      mode: 0o600,
    }),
  );
}

class FileAppLog implements AppLog {
  readonly #stream: WriteStream;

  constructor(stream: WriteStream) {
    this.#stream = stream;
  }

  write(event: string, details = ''): void {
    const record = {
      timestamp: new Date().toISOString(),
      event,
      details: redact(details).slice(0, 8_192),
    };
    this.#stream.write(`${JSON.stringify(record)}\n`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#stream.once('error', reject);
      this.#stream.end(resolve);
    });
  }
}

export function redact(value: string): string {
  return value
    .replaceAll(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    .replaceAll(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replaceAll(
      /([?&](?:api[_-]?key|access[_-]?token|token)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    )
    .replaceAll(/("?(?:api[_-]?key|token)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[REDACTED]$3');
}
