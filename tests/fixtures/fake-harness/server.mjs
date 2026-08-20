import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const host = args.get('--host') ?? '127.0.0.1';
const port = Number(args.get('--port'));
const companionReadyDelayMs = Number(args.get('--companion-ready-delay-ms') ?? 0);
const startedAt = Date.now();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error('A positive --port is required');
}

const server = createServer(async (request, response) => {
  if (
    request.url === '/plugins/@dsh-desktop/companion/rpc' &&
    request.method === 'POST'
  ) {
    if (Date.now() - startedAt < companionReadyDelayMs) {
      response.writeHead(405);
      response.end();
      return;
    }
    const payload = JSON.parse(await readRequest(request));
    const secret = process.env.DSH_DESKTOP_COMPANION_TOKEN ?? '';
    const proof =
      payload.kind === 'runtime.health' &&
      typeof payload.nonce === 'string' &&
      secret.length >= 32
        ? createHmac('sha256', secret).update(payload.nonce).digest('base64url')
        : undefined;
    if (proof === undefined) {
      response.writeHead(403);
      response.end();
      return;
    }
    const body = JSON.stringify({ status: 'ready', proof });
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      status: 'ready',
      home: process.env.DSH_HOME,
      path: process.env.PATH,
      workspace: process.cwd(),
      companionTokenConfigured:
        typeof process.env.DSH_DESKTOP_COMPANION_TOKEN === 'string' &&
        process.env.DSH_DESKTOP_COMPANION_TOKEN.length >= 32,
    }),
  );
});

server.listen(port, host);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
