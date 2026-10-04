import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * This package's browser code: `dist/client` from the built package, or
 * `src/client` when running from source (tests).
 */
export const CLIENT_DIR = fileURLToPath(new URL('./client/', import.meta.url));

/** A browser module of this package by name, e.g. `index`. */
export function clientModule(name: string, clientDir = CLIENT_DIR): string {
  for (const extension of ['.js', '.ts']) {
    const path = join(clientDir, `${name}${extension}`);
    if (existsSync(path)) return path;
  }
  throw new Error(`@soundor/web-runtime: missing client module '${name}'`);
}
