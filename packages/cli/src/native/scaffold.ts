/**
 * The project's Rust crate, scaffolded once by `soundor init` and never
 * overwritten: `native/` (the plugin's audio processing, the user's own) and
 * `rust-toolchain.toml`. Only the `soundor` dependency's path is Soundor's;
 * everything else in the crate is the user's to change.
 */
import type { ResolvedSoundorConfig } from '@soundor/config';
import { describeNativeApi } from '@soundor/core';

import { RUST_NAMES } from './codegen';
import { renderControllerScaffold } from './controller-codegen';

/** A file to scaffold, path relative to the project root. */
export interface NativeScaffoldFile {
  readonly path: string;
  readonly contents: string;
}

/** A Cargo package name from the plugin's name: `Soundor Basic` → `soundor-basic`. */
export function crateName(pluginName: string): string {
  const words = pluginName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  const name = words.join('-');
  return /^[a-z]/.test(name)
    ? name
    : `plugin${name.length > 0 ? `-${name}` : ''}`;
}

export function nativeScaffoldFiles(
  config: ResolvedSoundorConfig,
): NativeScaffoldFile[] {
  const gain = config.parameters.some(
    (parameter) => parameter.id === 'gain' && parameter.type === 'float32',
  );
  const name = crateName(config.plugin.name);
  const native = describeNativeApi(config.native);
  if (!native.ok) throw new Error('Invalid native API');
  const controller = renderControllerScaffold(native.model, RUST_NAMES);
  const processor = gain ? gainProcessor() : passThrough();
  return [
    { path: 'rust-toolchain.toml', contents: toolchain() },
    { path: 'native/Cargo.toml', contents: manifest(name) },
    { path: 'native/.gitignore', contents: '/target\n' },
    {
      path: 'native/src/lib.rs',
      contents: `//! The plugin's Rust entry point.

mod controller;
mod processor;

pub use controller::PluginController;
pub use processor::PluginProcessor;

soundor::export!(PluginProcessor, PluginController);
`,
    },
    { path: 'native/src/controller.rs', contents: controller },
    { path: 'native/src/processor.rs', contents: processor },
    { path: 'native/tests/controller.rs', contents: controllerTests(name) },
    {
      path: 'native/tests/processor.rs',
      contents: gain ? gainTests(name) : passThroughTests(name),
    },
    { path: 'native/tests/realtime.rs', contents: realtimeTests(name) },
  ];
}

function controllerTests(name: string): string {
  return `//! The controller, tested in plain Rust: \`cargo test --manifest-path native/Cargo.toml\`.

use ${crateIdent(name)}::PluginController;
use soundor::testing::TestController;

#[test]
fn starts_with_empty_stores() {
    let controller = TestController::<PluginController>::new();
    // With \`use soundor::prelude::*;\`, a synchronous method:
    // \`controller.task(PluginController::method)\`; an async one:
    // \`controller.block_on(PluginController::method(controller.async_context()))\`.
    controller.task(|ctx| assert_eq!(ctx.plugin.name, soundor::config::PLUGIN_NAME));
}
`;
}

function toolchain(): string {
  return `# The Rust that builds native/: stable, which rustup keeps up to date.
[toolchain]
channel = "stable"
`;
}

function manifest(name: string): string {
  return `# The plugin's audio processing, in Rust: yours, like any crate. Soundor's
# runtimes run it, natively in the JUCE plugin and compiled to WebAssembly on
# the Web; \`soundor dev\` and \`soundor build\` compile it with Cargo.
[package]
name = ${JSON.stringify(name)}
version = "0.1.0"
edition = "2024"
publish = false

[dependencies]
# Soundor's SDK, with the parameters and layouts of soundor.config.ts. Written
# by \`soundor gen\` (which \`soundor dev\` and \`soundor build\` run), from the
# installed soundor package: run it once before \`cargo test\` or \`cargo check\`.
soundor = { path = "../.soundor/generated/rust/soundor" }

# soundor dev's builds, and tests: optimized enough to process audio in real
# time, still with debug assertions and symbols.
[profile.dev]
opt-level = 1

# A workspace of its own, wherever the project is.
[workspace]
`;
}

function gainProcessor(): string {
  return `//! The plugin's audio processing. Soundor's runtimes run it: the JUCE
//! plugin natively, the Web host compiled to WebAssembly, in an AudioWorklet.
//! Its parameters are soundor.config.ts's, typed: \`ctx.params.gain\`.

use soundor::prelude::*;

/// Applies the \`gain\` parameter as a linear gain, ramping from one block's
/// value to the next so that automation doesn't click.
#[derive(Default)]
pub struct PluginProcessor {
    /// The last block's gain, where the next ramp starts.
    gain: f32,
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        // Start from the current value, rather than gliding up from silence.
        self.gain = ctx.params.gain;
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let target = ctx.params.gain;
        let frames = ctx.audio.frames();
        let step = if frames == 0 {
            0.0
        } else {
            (target - self.gain) / frames as f32
        };
        // The main output holds the main input: process it in place.
        for channel in ctx.audio.channels() {
            let mut gain = self.gain;
            for sample in channel {
                *sample *= gain;
                gain += step;
            }
        }
        self.gain = target;
    }
}
`;
}

function passThrough(): string {
  return `//! The plugin's audio processing. Soundor's runtimes run it: the JUCE
//! plugin natively, the Web host compiled to WebAssembly, in an AudioWorklet.
//! Its parameters are soundor.config.ts's, typed, in \`ctx.params\`.

use soundor::prelude::*;

/// Passes its input through: the main output starts each block holding the
/// main input, processed in place.
#[derive(Default)]
pub struct PluginProcessor;

impl Processor for PluginProcessor {
    fn prepare(&mut self, _ctx: &PrepareContext) {}

    fn process(&mut self, _ctx: &mut ProcessContext) {}
}
`;
}

function crateIdent(name: string): string {
  return name.replaceAll('-', '_');
}

function testImports(name: string, types: string): string {
  return [
    `use ${crateIdent(name)}::PluginProcessor;`,
    `use soundor::testing::${types};`,
  ]
    .sort()
    .join('\n');
}

function gainTests(name: string): string {
  return `//! The processor, tested in plain Rust: \`cargo test --manifest-path native/Cargo.toml\`.

${testImports(name, 'TestProcessor')}

#[test]
fn applies_the_gain() {
    let mut processor = TestProcessor::<PluginProcessor>::new()
        .sample_rate(48_000.0)
        .block_size(256)
        .parameter("gain", 0.5)
        .build();
    let output = processor.process(&[vec![1.0, 0.5, -1.0]]);
    assert_eq!(output[0], [0.5, 0.25, -0.5]);
}
`;
}

function passThroughTests(name: string): string {
  return `//! The processor, tested in plain Rust: \`cargo test --manifest-path native/Cargo.toml\`.

${testImports(name, 'TestProcessor')}

#[test]
fn passes_its_input_through() {
    let mut processor = TestProcessor::<PluginProcessor>::new().build();
    let output = processor.process(&[vec![1.0, 0.5, -1.0]]);
    assert_eq!(output[0], [1.0, 0.5, -1.0]);
}
`;
}

// Its own test binary: the allocator that counts is the binary's.
function realtimeTests(name: string): string {
  return `//! The processor runs on the audio thread, where an allocator call can take
//! a lock and miss the audio's deadline: it must make none while processing.

${testImports(name, '{CountingAllocator, TestProcessor}')}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn processing_does_not_allocate() {
    for block_size in [1, 64, 512, 4096] {
        let mut processor = TestProcessor::<PluginProcessor>::new()
            .block_size(block_size)
            .build();
        let input: Vec<f32> = (0..24_000)
            .map(|frame| (frame as f32 * 0.01).sin())
            .collect();
        processor.process(&[input.clone(), input]);
        assert_eq!(processor.allocations(), 0, "block size {block_size}");
    }
}
`;
}
