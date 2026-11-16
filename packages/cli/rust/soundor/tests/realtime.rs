//! Real-time safety: what the SDK does around a processor on the audio
//! thread (validation, block splitting, parameters, the transport,
//! read-only parameters, streams, the C ABI and the WebAssembly glue)
//! makes no allocator call, so a processor that makes none makes none.

use soundor::prelude::*;
use soundor::testing::{CountingAllocator, NativeProcessor, TestProcessor, count_allocations};
use soundor::wasm::{Status as WasmStatus, WasmHandle};

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// Everything a processor can touch: in-place audio, the sidechain,
/// parameters, the transport, a read-only parameter and both streams.
#[derive(Default)]
struct Meter {
    peak: f32,
}

impl AudioProcessor for Meter {
    fn prepare(&mut self, _: &PrepareContext) {
        self.peak = 0.0;
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let gain = if ctx.params.bypass {
            1.0
        } else {
            ctx.params.gain
        };
        let side = ctx.audio.input(1).map_or(0.0, |bus| {
            bus.channels()
                .flat_map(|channel| channel.iter())
                .fold(0.0f32, |peak, sample| peak.max(sample.abs()))
        });
        for channel in ctx.audio.channels() {
            for sample in channel {
                *sample *= gain;
                self.peak = self.peak.max(sample.abs());
            }
        }
        ctx.publish.peak(if self.peak > 0.0 {
            (20.0 * self.peak.log10()).max(-96.0)
        } else {
            -96.0
        });
        ctx.streams.level.publish(self.peak.max(side));
        ctx.streams.history.publish(&[
            gain,
            ctx.transport.tempo.unwrap_or(0.0) as f32,
            ctx.transport.position_beats.unwrap_or(0.0) as f32,
        ]);
    }
}

soundor::export!(Meter);

/// One that allocates in `process`, as a processor must not.
#[derive(Default)]
struct Collector {
    seen: Vec<f32>,
}

impl AudioProcessor for Collector {
    fn prepare(&mut self, _: &PrepareContext) {}

    fn process(&mut self, ctx: &mut ProcessContext) {
        for channel in ctx.audio.channels() {
            self.seen.extend_from_slice(channel);
        }
    }
}

fn sine(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|frame| (frame as f32 * 0.03).sin())
        .collect()
}

#[test]
fn counts_the_allocator_calls_it_is_given() {
    let ((), calls) = count_allocations(|| {
        let mut grown = Vec::<u32>::with_capacity(1);
        grown.extend([1, 2, 3, 4, 5]);
        drop(grown);
    });
    // The allocation, its growth, its free.
    assert_eq!(calls, 3);
    let ((), none) = count_allocations(|| {
        let mut sum = 0.0;
        for sample in sine(0) {
            sum += sample;
        }
        assert_eq!(sum, 0.0);
    });
    assert_eq!(none, 0);
}

#[test]
fn the_lifecycle_allocates_nothing_while_processing() {
    let mut processor = TestProcessor::<Meter>::new()
        .block_size(128)
        .layout(&[2, 2], &[2])
        .parameter("gain", 0.5)
        .build();
    processor.transport_mut().tempo = Some(120.0);
    let input = sine(48_000);
    let side = sine(48_000);
    for gain in [0.5, 0.25, 1.0] {
        processor.set_parameter("gain", gain);
        processor.process_buses(&[&[&input, &input], &[&side]]);
    }
    processor.set_parameter("bypass", 1.0);
    processor.process_buses(&[&[&input, &input], &[&side]]);
    assert_eq!(processor.allocations(), 0);
    assert!(processor.stream("level").unwrap() > 0.0);
}

#[test]
fn any_block_size_allocates_nothing() {
    for block_size in [1, 32, 128, 441, 512, 4096] {
        let mut processor = TestProcessor::<Meter>::new()
            .block_size(block_size)
            .parameter("gain", 0.5)
            .build();
        processor.process(&[sine(8192), sine(8192)]);
        assert_eq!(processor.allocations(), 0, "block size {block_size}");
    }
}

#[test]
fn finds_a_processor_that_allocates() {
    let mut processor = TestProcessor::<Collector>::new().block_size(64).build();
    processor.process(&[sine(1024)]);
    assert!(processor.allocations() > 0);
}

#[test]
fn the_c_abi_allocates_nothing_while_processing() {
    let mut native = NativeProcessor::new(__soundor_exports::exports());
    native.parameters[0] = 0.5;
    native.transport.tempo = 96.0;
    assert_eq!(native.prepare(48_000.0, 256, &[2], &[2]), 0);
    let mut channels = vec![sine(1000), sine(1000)];
    for _ in 0..50 {
        assert_eq!(native.process_in_place(&mut channels, &[]), 0);
    }
    assert_eq!(native.allocations(), 0);
    assert!(native.published[0] > -96.0);
}

#[test]
fn the_webassembly_glue_allocates_nothing_while_processing() {
    let mut handle = WasmHandle::<Meter>::new();
    // Two input buses (stereo, a stereo sidechain), one stereo output.
    handle.layout()[..5].copy_from_slice(&[2, 1, 2, 2, 2]);
    handle.parameters()[0] = 0.5;
    assert_eq!(handle.prepare(48_000.0, 128), WasmStatus::Ok);
    let (statuses, calls) = count_allocations(|| {
        let mut ok = true;
        for frames in [128, 1, 127, 64, 0, 128] {
            ok &= handle.process(frames) == WasmStatus::Ok;
            for stream in 0..2 {
                handle.take_stream_change(stream);
            }
        }
        ok
    });
    assert!(statuses);
    assert_eq!(calls, 0);
}
