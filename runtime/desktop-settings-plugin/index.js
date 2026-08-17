/** Host half: the desktop settings extension is browser-only. */
/* global URL */

import { readFile } from 'node:fs/promises';

const BRAND_PATH = new URL('./brand.png', import.meta.url);
const BRAND_ROUTE = '/plugins/@dsh-desktop/settings/brand.png';

export const inject = ['webServer'];

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: BRAND_ROUTE,
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405);
            response.end();
            return;
          }
          const body = await readFile(BRAND_PATH);
          response.writeHead(200, {
            'content-type': 'image/png',
            'cache-control': 'public, max-age=31536000, immutable',
          });
          response.end(request.method === 'HEAD' ? undefined : body);
        },
      }),
    'deepseek-yukiryou: brand asset route',
  );
}
