#!/usr/bin/env node
// soundor-vst3-host <command>
//
//   prepare [--mode prebuilt|source] [--artifact <dir>]   select or build the executable
//   resolve                                               print the executable launchHost() runs
//   inputs                                                print the native input fingerprint
import { parseArgs } from 'node:util';

import { Vst3HostError } from './errors.ts';
import { nativeInputs } from './inputs.ts';
import { type BuildMode, prepareHost } from './prepare.ts';
import { resolveHost } from './resolve.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string' },
    artifact: { type: 'string' },
    commit: { type: 'string' },
  },
});

try {
  switch (positionals[0]) {
    case 'prepare': {
      const mode = values.mode ?? 'prebuilt';
      if (mode !== 'prebuilt' && mode !== 'source')
        throw new Error(`--mode is "prebuilt" or "source", not "${mode}"`);
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
      console.error(
        'usage: soundor-vst3-host prepare [--mode prebuilt|source] [--artifact <dir>] | resolve | inputs',
      );
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
