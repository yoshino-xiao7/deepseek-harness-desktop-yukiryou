import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:https';
import { basename, join, resolve } from 'node:path';

const certificate = await readFile(required('--cert'));
const key = await readFile(required('--key'));
const assets = resolve(required('--assets'));
const metadata = resolve(required('--metadata'));
const target = required('--target');
const version = required('--version');
const port = Number.parseInt(argument('--port') ?? '443', 10);
const metadataName = target === 'darwin-arm64' ? 'latest-mac.yml'
  : target === 'win32-x64' ? 'latest.yml' : fail(`Unsupported target ${target}`);
const artifactName = target === 'darwin-arm64'
  ? `DeepSeek.YukiRyou-darwin-arm64-${version}.zip`
  : `DeepSeek.YukiRyou-${version}-win32-x64-Setup.exe`;
const routes = new Map([
  [`/updates/${target}/${metadataName}`, join(metadata, target, metadataName)],
  [`/releases/v${version}/${artifactName}`, join(assets, artifactName)],
]);

const server = createServer({ cert: certificate, key }, async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'https://download-cn.suzuki.ink').pathname;
  if (pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    response.end('ok');
    return;
  }
  const path = routes.get(pathname);
  if (path === undefined || basename(path) !== basename(pathname)) {
    response.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    response.end('not found');
    return;
  }
  try {
    const size = (await stat(path)).size;
    const range = parseRange(request.headers.range, size);
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    response.writeHead(range === undefined ? 200 : 206, {
      'content-type': path.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
      'content-length': String(end - start + 1),
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      ...(range === undefined ? {} : { 'content-range': `bytes ${start}-${end}/${size}` }),
    });
    createReadStream(path, { start, end }).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    response.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`automatic-update-gate ready target=${target} port=${port}\n`);
});

function required(name: string): string {
  const value = argument(name);
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
}

function argument(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function fail(message: string): never {
  throw new Error(message);
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (match === null) fail(`Unsupported range ${value}`);
  const start = Number.parseInt(match[1]!, 10);
  const requestedEnd = match[2] === '' ? size - 1 : Number.parseInt(match[2]!, 10);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) ||
    start < 0 || start >= size || requestedEnd < start) fail(`Invalid range ${value}`);
  return { start, end: Math.min(requestedEnd, size - 1) };
}
