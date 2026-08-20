import { setInterval } from 'node:timers';

setInterval(() => undefined, 1_000);

function shutdown() {
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
