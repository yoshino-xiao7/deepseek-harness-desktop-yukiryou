import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

it('registers third-party RPC routes with the bundled Connection service and releases them on unload', async () => {
  const patches = parse(await readFile('runtime/desktop-extensions.patch.yml', 'utf8')) as {
    id?: string;
    inject?: string[];
  }[];
  const connectionPatch = patches.find((patch) => patch.id === 'connection');
  const script = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const require = createRequire(pathToFileURL(${JSON.stringify(join(process.cwd(), 'resources/runtime/dsh/package.json'))}));
    const load = (name) => import(pathToFileURL(require.resolve(name)).href);
    const { Context } = await load('@deepseek-ai/cordis');
    const { HostConnectionService, inject } = await load('@deepseek-ai/dsh-client-connection');
    const root = new Context();
    const routes = new Map();
    try {
      await root.plugin((ctx) => {
        ctx.provide('credentials', {});
        ctx.provide('webRuntime', {});
        ctx.provide('webServer', {
          register(route) {
            routes.set(route.path, route);
            return () => routes.delete(route.path);
          },
        });
      });
      await root.plugin({
        inject: [...inject, ...${JSON.stringify(connectionPatch?.inject ?? [])}],
        apply(ctx) { new HostConnectionService(ctx, [], { isAuthenticated: () => false }); },
      });
      const consumer = root.plugin({
        inject: ['connection'],
        apply(ctx) {
          for (const channel of ['/dsh-codex', '/dsh-codex-session', '/dsh-codex-model-capabilities', '/dsh-codex-diagnostics']) {
            ctx.connection.rpc.handle(channel, async () => ({ ok: true, value: 'available' }));
          }
        },
      });
      await consumer.await();
      assert.equal(routes.size, 4);
      // A registered third-party route must retain the host's authentication fence.
      let status;
      let body;
      await routes.get('/dsh-codex').handler({ headers: { host: '127.0.0.1:3080' } }, {
        writeHead(code) { status = code; },
        end(value) { body = value; },
      });
      assert.equal(status, 401);
      assert.equal(body, 'unauthorized');
      await consumer.dispose();
      assert.equal(routes.size, 0);
    } finally {
      await root.fiber.dispose();
    }
    console.log('RPC registration, authentication and disposal passed');
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script]);
  expect(stdout).toContain('RPC registration, authentication and disposal passed');
});
