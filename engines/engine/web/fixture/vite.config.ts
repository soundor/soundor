import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

/** The locally built module (`pnpm build:wasm`), never a downloaded one. */
const wasm = fileURLToPath(
  new URL('../../build/wasm/web/soundor-core.wasm', import.meta.url),
);

function soundorCore(): Plugin {
  return {
    name: 'soundor-core-wasm',
    configureServer(server) {
      server.middlewares.use('/soundor-core.wasm', (_request, response) => {
        if (!existsSync(wasm)) {
          response.statusCode = 404;
          response.end(`${wasm} is missing: run pnpm build:wasm`);
          return;
        }
        response.setHeader('content-type', 'application/wasm');
        response.setHeader('cache-control', 'no-store');
        response.end(readFileSync(wasm));
      });
    },
  };
}

// The engine's internal browser fixture (`pnpm fixture`): index.html shows
// the demo, ?bare an empty page for the browser tests, bench.html the
// measurements. Never published.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [soundorCore()],
  // Cross-origin isolated, so that performance.now() is precise (bench.html).
  server: {
    port: 4380,
    headers: {
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    },
  },
  logLevel: 'warn',
});
