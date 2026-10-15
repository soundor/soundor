import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Resolve relative to this installed CLI, including its bundled entry point. */
export function resolveDevToolsClientDist(): string {
  const require = createRequire(import.meta.url);
  return join(
    dirname(require.resolve('@soundor/devtools-client/package.json')),
    'dist',
  );
}
