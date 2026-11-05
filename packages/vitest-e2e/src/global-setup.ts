import { existsSync } from 'node:fs';

import type { TestProject } from 'vitest/node';

/** A project with no bundle fails once, and only if it has tests to run. */
export default function setup(project: TestProject): void {
  const vst3 = project.config.provide.soundorE2E?.vst3;
  if (vst3 === undefined || existsSync(vst3)) return;
  const error = new Error(
    `The plugin to test does not exist: ${vst3}\nBuild it first: soundor build juce --debug makes a Debug build of a Soundor plugin, in .soundor/debug/juce/.`,
  );
  // Vitest 5.0.5 fails on the stack of an error from a global setup, and shows
  // that failure in place of this message.
  error.stack = error.message;
  throw error;
}
