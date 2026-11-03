import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type LaunchOptions,
  type Vst3Host,
  launchHost,
} from '../../src/index.ts';

const fixtures = process.env.SOUNDOR_VST3_HOST_FIXTURES;
if (!fixtures || !process.env.SOUNDOR_VST3_HOST_EXECUTABLE)
  throw new Error(
    'The native tests need a built host and fixtures: run `pnpm --filter @soundor/vst3-host test:native`',
  );

export const bundle = join(fixtures, 'SoundorHostFixtures.vst3');

export const GAIN = 1;
export const BYPASS = 2;
export const LATENCY = 3;
export const CRASH = 4;
export const HANG = 5;
export const EDITOR_TICKS = 6;
export const EDITOR_SIZE = 7;
export const PEAK = 8;
export const EDITOR_SCALE = 9;
export const VOLUME = 10;

/** Editors need a display: always on macOS and Windows, DISPLAY on Linux. */
export const hasDisplay =
  process.platform !== 'linux' || Boolean(process.env.DISPLAY);

const open = new Set<Vst3Host>();

export async function launch(
  className: string,
  options: Partial<LaunchOptions> = {},
): Promise<Vst3Host> {
  const host = await launchHost({ plugin: bundle, className, ...options });
  open.add(host);
  return host;
}

export async function closeAll(): Promise<void> {
  await Promise.all([...open].map((host) => host.close()));
  open.clear();
}

export function constant(frames: number, value: number): Float32Array {
  return new Float32Array(frames).fill(value);
}

export function ramp(frames: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, i) => (i % 100) / 100);
}

/** A bundle whose only binary is for a CPU this host is not. */
export function foreignBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'vst3-host-foreign-'));
  const path = join(root, 'Foreign.vst3');
  const arm = process.arch !== 'arm64';
  if (process.platform === 'linux') {
    const header = Buffer.alloc(4096);
    header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    header.writeUInt16LE(arm ? 0xb7 : 0x3e, 18);
    const directory = join(
      path,
      'Contents',
      arm ? 'aarch64-linux' : 'x86_64-linux',
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'Foreign.so'), header);
  } else if (process.platform === 'darwin') {
    const header = Buffer.alloc(4096);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(arm ? 0x0100000c : 0x01000007, 4);
    mkdirSync(join(path, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(path, 'Contents', 'MacOS', 'Foreign'), header);
  } else {
    const header = Buffer.alloc(4096);
    header.write('MZ', 0, 'latin1');
    header.writeUInt32LE(0x80, 0x3c);
    header.write('PE\0\0', 0x80, 'latin1');
    header.writeUInt16LE(arm ? 0xaa64 : 0x8664, 0x84);
    const directory = join(path, 'Contents', arm ? 'arm64-win' : 'x86_64-win');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'Foreign.vst3'), header);
  }
  return path;
}
