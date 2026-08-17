import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_MAX_FILE_BYTES = 2 * 1_024 * 1_024;
const DEFAULT_BACKUP_COUNT = 3;

export interface AppLog {
  write(event: string, details?: string): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface AppLogOptions {
  readonly maxFileBytes?: number;
  readonly backupCount?: number;
}

export async function createAppLog(
  logDirectory: string,
  options: AppLogOptions = {},
): Promise<AppLog> {
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const logPath = join(logDirectory, 'desktop.log');
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const backupCount = options.backupCount ?? DEFAULT_BACKUP_COUNT;
  const initialSize = await fileSize(logPath);
  return new FileAppLog(logPath, initialSize, maxFileBytes, backupCount);
}

class FileAppLog implements AppLog {
  readonly #logPath: string;
  readonly #maxFileBytes: number;
  readonly #backupCount: number;
  #size: number;
  #pending = Promise.resolve();
  #closed = false;

  constructor(
    logPath: string,
    initialSize: number,
    maxFileBytes: number,
    backupCount: number,
  ) {
    this.#logPath = logPath;
    this.#size = initialSize;
    this.#maxFileBytes = maxFileBytes;
    this.#backupCount = backupCount;
  }

  write(event: string, details = ''): void {
    if (this.#closed) {
      return;
    }
    const record = {
      timestamp: new Date().toISOString(),
      event,
      details: redact(details).slice(0, 8_192),
    };
    const line = `${JSON.stringify(record)}\n`;
    this.#pending = this.#pending.then(async () => {
      const bytes = Buffer.byteLength(line);
      if (this.#size > 0 && this.#size + bytes > this.#maxFileBytes) {
        await rotateLog(this.#logPath, this.#backupCount);
        this.#size = 0;
      }
      await appendFile(this.#logPath, line, { encoding: 'utf8', mode: 0o600 });
      this.#size += bytes;
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.flush();
  }

  async flush(): Promise<void> {
    await this.#pending;
  }
}

async function rotateLog(logPath: string, backupCount: number): Promise<void> {
  if (backupCount <= 0) {
    await removeIfPresent(logPath);
    return;
  }
  await removeIfPresent(`${logPath}.${String(backupCount)}`);
  for (let index = backupCount - 1; index >= 1; index -= 1) {
    await renameIfPresent(`${logPath}.${String(index)}`, `${logPath}.${String(index + 1)}`);
  }
  await renameIfPresent(logPath, `${logPath}.1`);
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissingFile(error)) {
      return 0;
    }
    throw error;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
}

async function renameIfPresent(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function redact(value: string): string {
  return value
    .replaceAll(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    .replaceAll(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replaceAll(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replaceAll(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replaceAll(
      /([?&](?:api[_-]?key|access[_-]?token|token)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    )
    .replaceAll(/("?(?:api[_-]?key|token)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
    .replaceAll(
      /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]',
    );
}
