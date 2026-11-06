#!/usr/bin/env node
// soundor-vst3-host <command>
//
//   open <plugin.vst3> [--class <name>] [--bare | --interface]
//        [--sample-rate <hz>] [--block-size <frames>]     open a plugin's editor until its window closes
//   prepare [--mode prebuilt|published|source] [--artifact <dir>]   select or build the executable
//   resolve                                               print the executable launchHost() runs
//   inputs                                                print the native input fingerprint
import { parseArgs } from 'node:util';

import { Vst3HostError } from './errors.ts';
import { launchHost } from './host.ts';
import { nativeInputs } from './inputs.ts';
import { type BuildMode, prepareHost } from './prepare.ts';
import { resolveHost } from './resolve.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string' },
    artifact: { type: 'string' },
    commit: { type: 'string' },
    class: { type: 'string' },
    bare: { type: 'boolean' },
    interface: { type: 'boolean' },
    'sample-rate': { type: 'string' },
    'block-size': { type: 'string' },
  },
});

const USAGE = `usage: soundor-vst3-host <command>
  open <plugin.vst3> [--class <name>] [--bare | --interface] [--sample-rate <hz>] [--block-size <frames>]
  prepare [--mode prebuilt|published|source] [--artifact <dir>] [--commit <sha>]
  resolve
  inputs`;

/** Opens a plugin's editor and waits until its window is closed. */
async function open(): Promise<void> {
  const plugin = positionals[1];
  if (plugin === undefined) throw new Error('open needs a .vst3 bundle');
  if (values.bare && values.interface)
    throw new Error('--bare and --interface are opposites');
  const number = (name: 'sample-rate' | 'block-size'): number | undefined => {
    const text = values[name];
    if (text === undefined) return undefined;
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`--${name} is a number`);
    return value;
  };
  const host = await launchHost({
    plugin,
    className: values.class,
    editor: true,
    presentation: values.bare ? 'editor' : values.interface ? 'host' : null,
    sampleRate: number('sample-rate'),
    blockSize: number('block-size'),
    requestTimeout: 0x7fffffff,
    onLog: (line) => console.error(line),
  });
  const closed = new Promise<void>((resolve) => {
    host.once('editorClosed', () => resolve());
    host.once('exit', () => resolve());
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
  console.error(
    `${host.info.name}: close its window (or press Ctrl+C) to quit`,
  );
  await closed;
  await host.close();
}

try {
  switch (positionals[0]) {
    case 'open':
      await open();
      break;
    case 'prepare': {
      const mode = values.mode ?? 'prebuilt';
      if (mode !== 'prebuilt' && mode !== 'published' && mode !== 'source')
        throw new Error(
          `--mode is "prebuilt", "published" or "source", not "${mode}"`,
        );
      await prepareHost({
        mode: mode as BuildMode,
        artifact: values.artifact,
        commit: values.commit,
      });
      break;
    }
    case 'resolve': {
      const resolved = resolveHost();
      console.log(
        `${resolved.executable}\t(${resolved.source}: ${resolved.reason})`,
      );
      break;
    }
    case 'inputs':
      console.log(JSON.stringify(nativeInputs(), null, 2));
      break;
    default:
      console.error(USAGE);
      process.exitCode = 64;
  }
} catch (error) {
  console.error(
    error instanceof Vst3HostError
      ? `error (${error.code}): ${error.message}`
      : `error: ${(error as Error).message}`,
  );
  process.exitCode = 1;
}
