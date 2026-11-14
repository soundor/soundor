// The fixture processor (the SDK's fixture contract) built with Cargo for
// wasm32-unknown-unknown, as the Web runtime builds a plugin's native/.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./', import.meta.url));

/** gain, bypass, mode, steps, peak (read-only); channels history, level. */
export const contract = { parameters: 5, published: 1, channels: 2 };
export const channels = [
  { kind: 'buffer', element: 'float32' },
  { kind: 'number', element: 'float32' },
] as const;
/** The parameters' plain values; a gain above 1 makes the fixture panic. */
export const parameters = (gain: number) => [gain, 0, 1, 0, -96];

/** The module's bytes. */
export function buildFixture(): Uint8Array<ArrayBuffer> {
  const built = spawnSync(
    'cargo',
    [
      'rustc',
      '--manifest-path',
      `${FIXTURE}Cargo.toml`,
      '--lib',
      '--crate-type',
      'cdylib',
      '--release',
      '--target',
      'wasm32-unknown-unknown',
    ],
    { encoding: 'utf8' },
  );
  if (built.status !== 0)
    throw new Error(
      `Cargo could not build the fixture for wasm32-unknown-unknown (rustup target add wasm32-unknown-unknown):\n${built.stderr}`,
    );
  return new Uint8Array(
    readFileSync(
      `${FIXTURE}target/wasm32-unknown-unknown/release/soundor_web_test_processor.wasm`,
    ),
  );
}
