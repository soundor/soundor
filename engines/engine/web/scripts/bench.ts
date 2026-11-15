// Measures the WebAssembly engine (`pnpm bench:wasm`, after build:wasm and
// build): its sizes, and fixture/bench.html's timings in headless Chromium.
// Prints a table and writes build/wasm/bench.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { chromium } from '@playwright/test';
import { build, createServer } from 'vite';

const root = join(import.meta.dirname, '../..');
const wasm = readFileSync(join(root, 'build/wasm/web/soundor-core.wasm'));

// The JavaScript a page loads: @soundor/engine/web, minified as an app would.
const bundled = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    minify: true,
    lib: {
      entry: join(root, 'web/src/index.ts'),
      formats: ['es'],
      fileName: 'web',
    },
  },
});
const output = (Array.isArray(bundled) ? bundled[0] : bundled) as {
  output: { type: string; code?: string }[];
};
const javascript = Buffer.from(
  output.output.find((chunk) => chunk.type === 'chunk')!.code!,
);

const sizes = (bytes: Buffer) => ({
  bytes: bytes.length,
  gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length,
});
const results: Record<string, unknown> = {
  'soundor-core.wasm': sizes(wasm),
  'web.js (minified)': sizes(javascript),
};

const server = await createServer({
  configFile: join(root, 'web/fixture/vite.config.ts'),
  server: { port: 0 },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  page.on('pageerror', (error) => console.error(error));
  await page.goto(new URL('bench.html', server.resolvedUrls!.local[0]).href);
  await page.waitForFunction(() => 'runBench' in window);
  results['timings (ms, median)'] = await page.evaluate(() =>
    window.runBench(),
  );
  results['browser'] = browser.version();
} finally {
  await browser.close();
  await server.close();
}

writeFileSync(
  join(root, 'build/wasm/bench.json'),
  `${JSON.stringify(results, null, 2)}\n`,
);
for (const [name, value] of Object.entries(results)) {
  if (typeof value !== 'object' || value === null) {
    console.log(`${name}: ${String(value)}`);
    continue;
  }
  console.log(`\n${name}`);
  for (const [key, figure] of Object.entries(value))
    console.log(
      `  ${key.padEnd(52)} ${typeof figure === 'number' ? figure.toFixed(figure < 1 ? 4 : 2) : String(figure)}`,
    );
}
