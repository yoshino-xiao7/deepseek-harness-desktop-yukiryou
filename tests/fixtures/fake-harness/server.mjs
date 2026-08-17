import { createServer } from 'node:http';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const host = args.get('--host') ?? '127.0.0.1';
const port = Number(args.get('--port'));

if (!Number.isInteger(port) || port <= 0) {
  throw new Error('A positive --port is required');
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      status: 'ready',
      home: process.env.DSH_HOME,
      path: process.env.PATH,
      workspace: process.cwd(),
    }),
  );
});

server.listen(port, host);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
