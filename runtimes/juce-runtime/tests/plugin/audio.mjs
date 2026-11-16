// The test plugin's audio through the VST3 host: the Rust gain `soundor gen`
// scaffolds (native/), run by the JUCE plugin, in stereo and in mono, at
// several block sizes. Run after `test:plugin` (Release) or
// `test:plugin:debug`: node tests/plugin/audio.mjs [path/to/Plugin.vst3]
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchHost } from '@soundor/vst3-host';

function findBundle(dir) {
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name.endsWith('.vst3')) return path;
    if (statSync(path).isDirectory()) {
      const found = findBundle(path);
      if (found) return found;
    }
  }
  return undefined;
}

const plugin =
  process.argv[2] ??
  findBundle(fileURLToPath(new URL('.soundor/dist/juce', import.meta.url))) ??
  findBundle(fileURLToPath(new URL('.soundor/debug/juce', import.meta.url)));
if (plugin === undefined) throw new Error('Build the test plugin first.');

const failures = [];
const expectExact = (actual, expected, what) => {
  if (actual.length !== expected.length) {
    failures.push(
      `${what}: ${actual.length} frames, expected ${expected.length}`,
    );
    return;
  }
  for (let frame = 0; frame < expected.length; frame++)
    // The host may normalize signed zero when it identifies a silent bus.
    if (actual[frame] !== expected[frame]) {
      failures.push(
        `${what}: frame ${frame} is ${actual[frame]}, not ${expected[frame]}`,
      );
      return;
    }
};
const signal = (frames, seed) =>
  Float32Array.from(
    { length: frames },
    (_, frame) => Math.sin(frame * 0.01 * seed) * 0.8,
  );
const scaled = (samples, gain) => samples.map((sample) => sample * gain);

for (const blockSize of [64, 512]) {
  const host = await launchHost({ plugin, sampleRate: 48_000, blockSize });
  try {
    await host.parameter('Gain').set(0.25);
    // The ramp from the prepared value to the new one, a block long.
    await host.process({ frames: blockSize * 2 });
    const left = signal(3000, 1);
    const right = signal(3000, 3);
    const stereo = await host.process({ inputs: [[left, right]] });
    expectExact(
      stereo.outputs[0][0],
      scaled(left, 0.25),
      `stereo left, blocks of ${blockSize}`,
    );
    expectExact(
      stereo.outputs[0][1],
      scaled(right, 0.25),
      `stereo right, blocks of ${blockSize}`,
    );

    await host.configure({
      inputs: [{ channels: 1 }],
      outputs: [{ channels: 1 }],
    });
    await host.parameter('Gain').set(1);
    await host.process({ frames: blockSize * 2 });
    const mono = await host.process({ inputs: [[left]] });
    if (mono.outputs[0].length !== 1)
      failures.push(`mono has ${mono.outputs[0].length} output channels`);
    expectExact(
      mono.outputs[0][0],
      left,
      `mono at unity, blocks of ${blockSize}`,
    );

    await host.parameter('Gain').set(0);
    await host.process({ frames: blockSize * 2 });
    const silent = await host.process({ inputs: [[left]] });
    expectExact(
      silent.outputs[0][0],
      new Float32Array(left.length),
      `mono at zero, blocks of ${blockSize}`,
    );
  } finally {
    await host.close();
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.info(
  `${plugin}: the Rust gain processes stereo and mono in the VST3 host`,
);
