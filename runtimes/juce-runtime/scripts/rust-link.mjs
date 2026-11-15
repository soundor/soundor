// A real plugin build/link regression, with the existing headless VST3 host.
// No editor, accessibility client or screen-reader harness is involved.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchHost } from '@soundor/vst3-host';

assert.equal(process.platform, 'linux', 'This is a Linux linkage regression');
const runtime = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(runtime, '../..');
const project = join(runtime, '.soundor/rust-link');
const config = join(project, 'soundor.config.ts');
const engineArgument = process.argv.indexOf('--engine');
const engine =
  engineArgument < 0 ? undefined : resolve(process.argv[engineArgument + 1]);
const debug =
  engine !== undefined &&
  JSON.parse(readFileSync(join(engine, 'soundor-engine.json'), 'utf8'))
    .variant === 'debug';
const cli = join(root, 'packages/cli/dist/index.mjs');
const run = (command, args) =>
  execFileSync(command, args, { cwd: runtime, stdio: 'inherit' });
mkdirSync(join(project, 'src'), { recursive: true });
writeFileSync(
  config,
  `
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
export default defineSoundorConfig({
  plugin: { id: 'dev.soundor.rust-link', name: 'SoundorRustLink' },
  editor: { width: 200, height: 100 },
  parameters: { gain: { label: 'Gain', type: 'float32', min: 0, max: 1, default: 0.5 } },
  runtimes: [juceRuntime({ formats: ['vst3'], engine: { mode: 'prebuilt' } })],
});
`,
);
writeFileSync(
  join(project, 'src/main.ts'),
  `import { root, createText } from 'soundor:ui'; root.appendChild(createText('Rust link regression'));`,
);
run(process.execPath, [cli, 'init', '--config', config]);
// These are this fixture's own host files, produced by the current scaffolder.
// Regenerate them from init in a fresh project on first use; only replace the
// DSP in this fixture, leaving the SDK and processor integration unchanged.
const hostDirectory = join(project, 'runtimes/juce');
const processorPath = join(hostDirectory, 'PluginProcessor.cpp');
let processor = readFileSync(processorPath, 'utf8');
if (!processor.includes('soundor_rust_process')) {
  processor =
    `#include <cstddef>\nextern "C" std::size_t soundor_rust_initialize();\nextern "C" void soundor_rust_process(float*, std::size_t, float);\n` +
    processor;
  processor = processor.replace(
    '    previousGain = gainParameter.load();',
    '    previousGain = gainParameter.load();\n    if (soundor_rust_initialize() != 8) throw std::runtime_error("Rust initialization failed");',
  );
  processor = processor.replace(
    /void SoundorRustLinkProcessor::process\([^]*?\n\}/,
    `void SoundorRustLinkProcessor::process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)\n{\n    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)\n        soundor_rust_process(buffer.getWritePointer(channel), static_cast<std::size_t>(buffer.getNumSamples()), gainParameter.load());\n}`,
  );
  assert(processor.includes('soundor_rust_process(buffer.getWritePointer'));
  writeFileSync(processorPath, processor);
}
const cmakePath = join(hostDirectory, 'CMakeLists.txt');
let cmake = readFileSync(cmakePath, 'utf8')
  .split('# Rust link fixture')[0]
  .replace(/^set\(SOUNDOR_ENGINE_PREBUILT_(?:DEBUG|RELEASE)_DIR .*\)\n/gm, '');
if (engine !== undefined) {
  const variable = debug
    ? 'SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR'
    : 'SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR';
  cmake = cmake.replace(
    /^include\(/m,
    `set(${variable} [==[${engine}]==] CACHE PATH "" FORCE)\ninclude(`,
  );
}
const rustSource = join(runtime, 'tests/rust-link/processor.rs');
cmake += `
# Rust link fixture
find_program(RUSTC rustc REQUIRED)
set(RUST_LIBRARY "\${CMAKE_CURRENT_BINARY_DIR}/libsoundor_rust_link.a")
add_custom_command(OUTPUT "\${RUST_LIBRARY}"
  COMMAND "\${RUSTC}" --edition=2024 --crate-type=staticlib --crate-name=soundor_rust_link
    -C opt-level=1 -C panic=unwind [==[${rustSource}]==] -o "\${RUST_LIBRARY}"
  DEPENDS [==[${rustSource}]==] VERBATIM)
add_custom_target(soundor_rust_archive DEPENDS "\${RUST_LIBRARY}")
add_library(soundor_rust_processor STATIC IMPORTED)
set_target_properties(soundor_rust_processor PROPERTIES IMPORTED_LOCATION "\${RUST_LIBRARY}")
add_dependencies(soundor_rust_processor soundor_rust_archive)
target_link_libraries(\${PROJECT_NAME} PRIVATE soundor_rust_processor \${CMAKE_DL_LIBS} m rt util)
`;
writeFileSync(cmakePath, cmake);
run(process.execPath, [
  cli,
  'build',
  'juce',
  ...(debug ? ['--debug'] : []),
  '--config',
  config,
]);
const build = join(
  project,
  '.soundor/cache/juce',
  debug ? 'build-debug-build' : 'build-release',
);
const ninja = readFileSync(join(build, 'build.ninja'), 'utf8');
assert(
  !ninja.includes('libaccesskit.a'),
  'Linux link must not contain AccessKit',
);
assert(
  !ninja.includes('soundor_runtime.dir/src/'),
  'Regression must consume the prebuilt C++ engine',
);
assert(ninja.includes('libsoundor_rust_link.a'));
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(path, entry.name))
      : [join(path, entry.name)],
  );
const binary = walk(
  join(project, debug ? '.soundor/debug/juce' : '.soundor/dist/juce'),
).find((path) => path.endsWith('.so') && path.includes('.vst3/'));
assert(binary, 'VST3 binary must exist');
const dependencies = execFileSync('readelf', ['-d', binary], {
  encoding: 'utf8',
});
assert(
  dependencies.includes('[libgio-2.0.so.0]'),
  'System GIO must remain dynamically linked',
);
const symbols = execFileSync('nm', ['--defined-only', binary], {
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
});
assert(symbols.includes('soundor_rust_process'), 'Rust DSP must be linked');
assert.equal(
  symbols.split('\n').filter((line) => /\srust_eh_personality$/.test(line))
    .length,
  1,
);
const bundle = dirname(dirname(dirname(binary)));
const host = await launchHost({ plugin: bundle, editor: false });
try {
  const channel = new Float32Array(64).fill(0.5);
  const rendered = await host.process({ inputs: [[channel, channel]] });
  assert.equal(rendered.frames, 64);
  for (const output of rendered.outputs[0])
    for (const sample of output)
      assert(
        Math.abs(sample - 0.25) < 1e-6,
        'Rust processor should apply gain',
      );
} finally {
  await host.close();
}
console.log(
  `Rust/prebuilt/JUCE linkage and headless audio loading passed: ${binary}`,
);
