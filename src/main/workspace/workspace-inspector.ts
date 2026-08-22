import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import type {
  WorkspaceChange,
  HistoricalDiff,
  WorkspaceNode,
  WorkspaceReviewResponse,
  WorkspaceSearchNode,
} from '../../shared/workspace-review.js';
import { createBoundedLruCache } from './bounded-lru-cache.js';
import { readStableRegularFile, stableRegularFileRevision, type StableFileRead } from './stable-file-reader.js';

const execFileAsync = promisify(execFile);
const MAX_DIRECTORY_ENTRIES = 500;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GIT_OUTPUT = 2 * 1024 * 1024;
const MAX_TREE_DEPTH = 20;
const MAX_SEARCH_ENTRIES = 5_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_PREVIEW_CACHE_BYTES = 64 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.astro', '.next', '.turbo', '.pnpm-store', '.codex-pet-runs',
  'node_modules', 'dist', 'build', 'coverage',
]);
const EXCLUDED_FILES = new Set(['.DS_Store']);

interface NodeRecord {
  readonly id: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly name: string;
  readonly kind: 'directory' | 'file';
  readonly depth: number;
}

export interface WorkspaceInspector {
  overview(): Promise<WorkspaceReviewResponse>;
  search(query: string): Promise<WorkspaceReviewResponse>;
  listDirectory(nodeId: string): Promise<WorkspaceReviewResponse>;
  preview(nodeId: string): Promise<WorkspaceReviewResponse>;
  previewRelative(nodeId: string, target: string): Promise<WorkspaceReviewResponse>;
  diff(nodeId: string): Promise<WorkspaceReviewResponse>;
  previewChangedPath(relativePath: string, historicalDiff?: HistoricalDiff): Promise<WorkspaceReviewResponse>;
}

export function createWorkspaceInspector(root: string, previewCacheBytes = MAX_PREVIEW_CACHE_BYTES): WorkspaceInspector {
  return new NodeWorkspaceInspector(root, previewCacheBytes);
}

type PreviewResponse = Extract<WorkspaceReviewResponse, { kind: 'preview' }>;

class NodeWorkspaceInspector implements WorkspaceInspector {
  readonly #root: string;
  readonly #nodes = new Map<string, NodeRecord>();
  readonly #idsByPath = new Map<string, string>();
  readonly #rootNode: NodeRecord;
  readonly #previewCache;

  constructor(root: string, previewCacheBytes: number) {
    this.#root = root;
    this.#previewCache = createBoundedLruCache<{ readonly revision: string; readonly response: PreviewResponse }>(previewCacheBytes);
    this.#rootNode = this.#register(root, '', basename(root), 'directory', 0);
  }

  async overview(): Promise<WorkspaceReviewResponse> {
    try {
      const directory = await this.#readDirectory(this.#rootNode);
      const git = await this.#gitChanges();
      return {
        kind: 'overview', rootName: displayName(basename(this.#root)), nodes: directory.nodes,
        changes: git.changes, gitAvailable: git.available,
        truncated: directory.truncated || git.truncated,
      };
    } catch {
      return { kind: 'unavailable', reason: 'io-error' };
    }
  }

  async search(query: string): Promise<WorkspaceReviewResponse> {
    const terms = query.toLocaleLowerCase().split(' ').filter(Boolean);
    const directories: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
      { absolutePath: this.#root, relativePath: '', depth: 0 },
    ];
    const nodes: WorkspaceSearchNode[] = [];
    let visited = 0;
    let truncated = false;
    try {
      for (let index = 0; index < directories.length; index += 1) {
        const directory = directories[index];
        if (directory === undefined) continue;
        const directoryStatus = await lstat(directory.absolutePath);
        if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) continue;
        const entries = await readdir(directory.absolutePath, { withFileTypes: true });
        const visible = entries
          .filter((entry) => (
            (!entry.isDirectory() || !EXCLUDED_DIRECTORIES.has(entry.name))
            && (!entry.isFile() || !EXCLUDED_FILES.has(entry.name))
            && (entry.isDirectory() || entry.isFile())
          ))
          .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name));
        for (const entry of visible) {
          visited += 1;
          if (visited > MAX_SEARCH_ENTRIES) {
            truncated = true;
            break;
          }
          const relativePath = directory.relativePath === ''
            ? entry.name
            : `${directory.relativePath}/${entry.name}`;
          const absolutePath = join(directory.absolutePath, entry.name);
          const depth = directory.depth + 1;
          if (entry.isDirectory()) {
            if (depth < MAX_TREE_DEPTH) directories.push({ absolutePath, relativePath, depth });
            else truncated = true;
            continue;
          }
          const searchable = relativePath.toLocaleLowerCase();
          if (!terms.every((term) => searchable.includes(term))) continue;
          const node = this.#register(absolutePath, relativePath, entry.name, 'file', depth);
          nodes.push({
            id: node.id,
            name: displayName(node.name),
            kind: 'file',
            path: displayName(relativePath),
            ...(extname(node.name) === '' ? {} : { extension: extname(node.name).slice(1).toLowerCase() }),
          });
          if (nodes.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            break;
          }
        }
        if (truncated) break;
      }
      return { kind: 'search', query, nodes, truncated };
    } catch {
      return { kind: 'unavailable', reason: 'io-error' };
    }
  }

  async listDirectory(nodeId: string): Promise<WorkspaceReviewResponse> {
    const node = this.#nodes.get(nodeId);
    if (node?.kind !== 'directory') return { kind: 'unavailable', reason: 'invalid-node' };
    try {
      const result = await this.#readDirectory(node);
      return { kind: 'directory', parentId: node.id, ...result };
    } catch {
      return { kind: 'unavailable', reason: 'io-error' };
    }
  }

  async preview(nodeId: string): Promise<WorkspaceReviewResponse> {
    const node = this.#nodes.get(nodeId);
    if (node?.kind !== 'file') return { kind: 'unavailable', reason: 'invalid-node' };
    try {
      const currentRevision = await stableRegularFileRevision(node.absolutePath);
      if (currentRevision.kind !== 'revision') {
        return currentRevision.kind === 'unsafe-type'
          ? this.#unsupported(node, 'unsupported-type')
          : { kind: 'unavailable', reason: 'io-error' };
      }
      const cached = this.#previewCache.get(node.id);
      if (cached?.revision === currentRevision.revision) return cached.response;
      const extension = extname(node.name).toLowerCase();
      const mime = imageMime(extension);
      if (mime !== undefined) {
        const read = await readStableRegularFile(node.absolutePath, MAX_IMAGE_BYTES);
        if (read.kind !== 'data') return this.#readFailure(node, read);
        const { data } = read;
        const dimensions = imageDimensions(data, mime);
        if (dimensions === undefined) return this.#unsupported(node, 'invalid-encoding');
        if (dimensions.width > 16_384 || dimensions.height > 16_384 || dimensions.width * dimensions.height > 32_000_000) {
          return this.#unsupported(node, 'too-large');
        }
        return this.#cachePreview(node, read.revision, { kind: 'image', dataUrl: `data:${mime};base64,${data.toString('base64')}` });
      }
      const read = await readStableRegularFile(node.absolutePath, MAX_TEXT_BYTES);
      if (read.kind !== 'data') return this.#readFailure(node, read);
      const { data } = read;
      if (data.subarray(0, 8_192).includes(0)) return this.#unsupported(node, 'binary');
      const text = decodeUtf8(data);
      if (text === undefined) return this.#unsupported(node, 'invalid-encoding');
      return this.#cachePreview(node, read.revision, { kind: extension === '.md' || extension === '.markdown' ? 'markdown' : 'text', text, truncated: false });
    } catch {
      return { kind: 'unavailable', reason: 'io-error' };
    }
  }

  async previewRelative(nodeId: string, target: string): Promise<WorkspaceReviewResponse> {
    const source = this.#nodes.get(nodeId);
    if (source?.kind !== 'file' || target === '' || target.includes('\\') || target.includes('\0')) {
      return { kind: 'unavailable', reason: 'invalid-node' };
    }
    const absolutePath = resolve(dirname(source.absolutePath), target);
    const relativePath = workspaceRelativePath(this.#root, absolutePath);
    if (!safeRelativePath(relativePath)) return { kind: 'unavailable', reason: 'invalid-node' };
    const targetNodeId = await this.#registerExistingFile(relativePath);
    return targetNodeId === undefined
      ? { kind: 'unavailable', reason: 'invalid-node' }
      : this.preview(targetNodeId);
  }

  async diff(nodeId: string): Promise<WorkspaceReviewResponse> {
    const node = this.#nodes.get(nodeId);
    if (node?.kind !== 'file' || !safeRelativePath(node.relativePath)) {
      return { kind: 'unavailable', reason: 'invalid-node' };
    }
    try {
      const { stdout } = await this.#git(
        ['diff', '--no-ext-diff', '--no-color', '--unified=3', 'HEAD', '--', node.relativePath],
        5_000,
        MAX_GIT_OUTPUT,
      );
      const text = String(stdout);
      if (text !== '') return this.#preview(node, { kind: 'diff', text, truncated: false, ...countDiffLines(text) });
      const git = await this.#gitChanges();
      if (git.changes.some((change) => change.path === node.relativePath && change.status === 'untracked')) {
        return this.#untrackedDiff(node.id);
      }
      return { kind: 'unavailable', reason: 'invalid-node' };
    } catch {
      return { kind: 'unavailable', reason: 'io-error' };
    }
  }

  async previewChangedPath(relativePath: string, historicalDiff?: HistoricalDiff): Promise<WorkspaceReviewResponse> {
    if (!safeRelativePath(relativePath)) return { kind: 'unavailable', reason: 'invalid-node' };
    const git = await this.#gitChanges();
    const change = git.changes.find((candidate) => candidate.path === relativePath);
    if (change?.nodeId !== undefined) {
      if (change.status === 'untracked') return this.#untrackedDiff(change.nodeId);
      return this.diff(change.nodeId);
    }
    if (historicalDiff === undefined) return { kind: 'unavailable', reason: 'invalid-node' };
    const historicalNodeId = await this.#registerExistingFile(relativePath);
    const node = historicalNodeId === undefined
      ? this.#register(join(this.#root, relativePath), relativePath, basename(relativePath), 'file', relativePath.split('/').length)
      : this.#nodes.get(historicalNodeId);
    return node === undefined
      ? { kind: 'unavailable', reason: 'invalid-node' }
      : this.#preview(node, { kind: 'diff', truncated: false, ...historicalDiff });
  }

  async #readDirectory(parent: NodeRecord): Promise<{ nodes: WorkspaceNode[]; truncated: boolean }> {
    const parentStatus = await lstat(parent.absolutePath);
    if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) throw new Error('directory capability changed');
    if (parent.depth >= MAX_TREE_DEPTH) return { nodes: [], truncated: true };
    const entries = await readdir(parent.absolutePath, { withFileTypes: true });
    const visible = entries
      .filter((entry) => (
        (!entry.isDirectory() || !EXCLUDED_DIRECTORIES.has(entry.name))
        && (!entry.isFile() || !EXCLUDED_FILES.has(entry.name))
        && (entry.isDirectory() || entry.isFile())
      ))
      .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name));
    const nodes: WorkspaceNode[] = [];
    for (const entry of visible.slice(0, MAX_DIRECTORY_ENTRIES)) {
      const absolutePath = join(parent.absolutePath, entry.name);
      const relativePath = workspaceRelativePath(this.#root, absolutePath);
      const node = this.#register(absolutePath, relativePath, entry.name, entry.isDirectory() ? 'directory' : 'file', parent.depth + 1);
      nodes.push({ id: node.id, name: displayName(node.name), kind: node.kind, ...(node.kind === 'file' && extname(node.name) !== '' ? { extension: extname(node.name).slice(1).toLowerCase() } : {}) });
    }
    return { nodes, truncated: visible.length > MAX_DIRECTORY_ENTRIES };
  }

  async #gitChanges(): Promise<{ available: boolean; changes: WorkspaceChange[]; truncated: boolean }> {
    try {
      await this.#git(['rev-parse', '--is-inside-work-tree'], 3_000, 64 * 1024);
      const [{ stdout: statusOutput }, { stdout: numstatOutput }] = await Promise.all([
        this.#git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], 5_000, MAX_GIT_OUTPUT, 'buffer'),
        this.#git(['diff', '--no-ext-diff', '--numstat', 'HEAD'], 5_000, MAX_GIT_OUTPUT),
      ]);
      const stats = parseNumstat(String(numstatOutput));
      const records = Buffer.from(statusOutput).toString('utf8').split('\0').filter(Boolean);
      const changes: WorkspaceChange[] = [];
      for (let index = 0; index < records.length && changes.length < 1_000; index += 1) {
        const record = records[index];
        if (record === undefined || record.length < 4) continue;
        const x = record[0] ?? ' ';
        const y = record[1] ?? ' ';
        const path = record.slice(3);
        if (x === 'R' || y === 'R') index += 1; // porcelain -z emits the old path as the following record.
        const nodeId = await this.#registerExistingFile(path);
        const stat = stats.get(path);
        changes.push({
          ...(nodeId === undefined ? {} : { nodeId }), path: displayName(path),
          status: changeStatus(x, y), staged: x !== ' ' && x !== '?',
          ...(stat === undefined ? {} : stat),
        });
      }
      return { available: true, changes, truncated: records.length > 1_000 };
    } catch {
      return { available: false, changes: [], truncated: false };
    }
  }

  async #registerExistingFile(relativePath: string): Promise<string | undefined> {
    if (!safeRelativePath(relativePath)) return undefined;
    const absolutePath = join(this.#root, relativePath);
    try {
      const status = await lstat(absolutePath);
      if (!status.isFile()) return undefined;
      return this.#register(absolutePath, relativePath, basename(relativePath), 'file', relativePath.split('/').length).id;
    } catch {
      return undefined;
    }
  }

  async #untrackedDiff(nodeId: string): Promise<WorkspaceReviewResponse> {
    const node = this.#nodes.get(nodeId);
    if (node?.kind !== 'file') return { kind: 'unavailable', reason: 'invalid-node' };
    try {
      const read = await readStableRegularFile(node.absolutePath, MAX_TEXT_BYTES);
      if (read.kind !== 'data') return this.#readFailure(node, read);
      const { data } = read;
      if (data.subarray(0, 8_192).includes(0)) return this.#unsupported(node, 'binary');
      const decoded = decodeUtf8(data);
      if (decoded === undefined) return this.#unsupported(node, 'invalid-encoding');
      const lines = decoded.replaceAll('\r\n', '\n').split('\n');
      if (lines.at(-1) === '') lines.pop();
      const text = [
        `diff --git a/${node.relativePath} b/${node.relativePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${node.relativePath}`,
        `@@ -0,0 +1,${String(lines.length)} @@`,
        ...lines.map((line) => `+${line}`),
        '',
      ].join('\n');
      return this.#preview(node, { kind: 'diff', text, truncated: false, additions: lines.length, deletions: 0 });
    } catch {
      return { kind: 'unavailable', reason: 'io-error' };
    }
  }

  #register(absolutePath: string, relativePath: string, name: string, kind: NodeRecord['kind'], depth: number): NodeRecord {
    const existing = this.#idsByPath.get(relativePath);
    if (existing !== undefined) return this.#nodes.get(existing)!;
    const id = randomBytes(18).toString('base64url');
    const node = { id, absolutePath, relativePath, name, kind, depth };
    this.#nodes.set(id, node);
    this.#idsByPath.set(relativePath, id);
    return node;
  }

  #preview(node: NodeRecord, content: Extract<WorkspaceReviewResponse, {kind:'preview'}>['content']): WorkspaceReviewResponse {
    return { kind: 'preview', nodeId: node.id, name: displayName(node.name), path: displayName(node.relativePath), content };
  }

  #cachePreview(
    node: NodeRecord,
    revision: string,
    content: PreviewResponse['content'],
  ): PreviewResponse {
    const response = this.#preview(node, content) as PreviewResponse;
    this.#previewCache.set(node.id, { revision, response }, estimatedPreviewBytes(content));
    return response;
  }

  #unsupported(node: NodeRecord, reason: 'binary' | 'invalid-encoding' | 'too-large' | 'unsupported-type'): WorkspaceReviewResponse {
    return this.#preview(node, { kind: 'unsupported', reason });
  }

  #readFailure(node: NodeRecord, result: Exclude<StableFileRead, { kind: 'data' }>): WorkspaceReviewResponse {
    if (result.kind === 'too-large') return this.#unsupported(node, 'too-large');
    if (result.kind === 'unsafe-type') return this.#unsupported(node, 'unsupported-type');
    return { kind: 'unavailable', reason: result.kind };
  }

  #git(
    args: string[],
    timeout: number,
    maxBuffer: number,
    encoding?: 'buffer',
  ): ReturnType<typeof execFileAsync> {
    return execFileAsync(
      'git',
      ['--literal-pathspecs', '-c', 'core.fsmonitor=false', '--no-pager', '-C', this.#root, ...args],
      {
        timeout,
        maxBuffer,
        ...(encoding === undefined ? {} : { encoding }),
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
    );
  }
}

function countDiffLines(source: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function decodeUtf8(data: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
}

function estimatedPreviewBytes(content: PreviewResponse['content']): number {
  if (content.kind === 'image') return content.dataUrl.length * 2;
  if ('text' in content) return content.text.length * 2;
  return 256;
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split('\n')) {
    const [added, deleted, path] = line.split('\t');
    if (path === undefined || added === undefined || deleted === undefined || added === '-' || deleted === '-') continue;
    const additions = Number(added);
    const deletions = Number(deleted);
    if (Number.isSafeInteger(additions) && Number.isSafeInteger(deletions)) result.set(path, { additions, deletions });
  }
  return result;
}

function changeStatus(x: string, y: string): WorkspaceChange['status'] {
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'A') return 'added';
  return 'modified';
}

function imageMime(extension: string): string | undefined {
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[extension];
}

function imageDimensions(data: Buffer, mime: string): { width: number; height: number } | undefined {
  if (mime === 'image/png') {
    if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || data.toString('ascii', 12, 16) !== 'IHDR') return undefined;
    return positiveDimensions(data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if (mime === 'image/gif') {
    if (data.length < 10 || (data.toString('ascii', 0, 6) !== 'GIF87a' && data.toString('ascii', 0, 6) !== 'GIF89a')) return undefined;
    return positiveDimensions(data.readUInt16LE(6), data.readUInt16LE(8));
  }
  if (mime === 'image/jpeg') return jpegDimensions(data);
  if (mime === 'image/webp') return webpDimensions(data);
  return undefined;
}

function jpegDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  const sizeMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < data.length) {
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) return undefined;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return undefined;
    if (sizeMarkers.has(marker) && length >= 7) return positiveDimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
    offset += length;
  }
  return undefined;
}

function webpDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 30 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') return undefined;
  const kind = data.toString('ascii', 12, 16);
  if (kind === 'VP8X') return positiveDimensions(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
  if (kind === 'VP8L' && data[20] === 0x2f) {
    const first = data[21] ?? 0;
    const second = data[22] ?? 0;
    const third = data[23] ?? 0;
    const fourth = data[24] ?? 0;
    return positiveDimensions(1 + first + ((second & 0x3f) << 8), 1 + (second >> 6) + (third << 2) + ((fourth & 0x0f) << 10));
  }
  if (kind === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return positiveDimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
  }
  return undefined;
}

function positiveDimensions(width: number, height: number): { width: number; height: number } | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function safeRelativePath(value: string): boolean {
  return value !== '' && !value.startsWith('/') && !value.includes('\\') &&
    !value.split('/').includes('..') && !value.includes('\0');
}

function workspaceRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/');
}

function displayName(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127
      ? `\\u${code.toString(16).padStart(4, '0')}`
      : character;
  }).join('');
}
