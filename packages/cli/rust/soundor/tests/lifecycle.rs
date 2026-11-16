//! The SDK's lifecycle, through `soundor::testing`, against the fixture
//! config (rust/fixture/soundor.config.ts).

use soundor::choices::Mode;
use soundor::prelude::*;
use soundor::testing::{Status, TestProcessor};

/// What `prepare` was given: rate, frames, inputs, outputs, layout name.
type Prepared = (f64, usize, Vec<usize>, Vec<usize>, Option<&'static str>);

/// A processor that applies `gain`, records what it was told, publishes its
/// peak and fills both streams.
#[derive(Default)]
struct Probe {
    prepared: Vec<Prepared>,
    blocks: Vec<usize>,
    resets: usize,
    history: f32,
    panic_in_process: bool,
    tempo: Option<f64>,
}

impl AudioProcessor for Probe {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.prepared.push((
            ctx.sample_rate,
            ctx.max_frames,
            ctx.layout.inputs().to_vec(),
            ctx.layout.outputs().to_vec(),
            ctx.layout.name(),
        ));
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        assert!(!self.panic_in_process, "the probe was told to panic");
        self.blocks.push(ctx.audio.frames());
        self.tempo = ctx.transport.tempo;
        let gain = if ctx.params.bypass {
            1.0
        } else {
            ctx.params.gain
        };
        let mut peak = 0.0f32;
        for channel in ctx.audio.channels() {
            for sample in channel {
                *sample *= gain;
                peak = peak.max(sample.abs());
                self.history += *sample;
            }
        }
        if ctx.params.mode == Mode::HardClip {
            for channel in ctx.audio.channels() {
                for sample in channel {
                    *sample = sample.clamp(-0.5, 0.5);
                }
            }
        }
        let decibels = if peak > 0.0 {
            (20.0 * peak.log10()).max(-96.0)
        } else {
            -96.0
        };
        ctx.publish.peak(decibels.min(0.0));
        ctx.streams.level.publish(peak);
        ctx.streams.history.publish(&[peak, self.history]);
    }

    fn reset(&mut self) {
        self.resets += 1;
        self.history = 0.0;
    }
}

fn ramp(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|index| index as f32 / frames as f32 - 0.5)
        .collect()
}

#[test]
fn prepares_with_the_rate_block_size_and_default_layout() {
    let processor = TestProcessor::<Probe>::new()
        .sample_rate(44_100.0)
        .block_size(64)
        .build();
    assert_eq!(
        processor.processor().prepared,
        [(44_100.0, 64, vec![2, 0], vec![2], Some("stereo"))]
    );
}

#[test]
fn names_the_active_layout_from_the_config() {
    let mono = TestProcessor::<Probe>::new().named_layout("mono").build();
    assert_eq!(mono.processor().prepared[0].4, Some("mono"));
    let widening = TestProcessor::<Probe>::new().layout(&[1, 0], &[2]).build();
    assert_eq!(widening.processor().prepared[0].4, Some("monoToStereo"));
    let unsupported = TestProcessor::<Probe>::new().layout(&[6, 0], &[6]).build();
    assert_eq!(unsupported.processor().prepared[0].4, None);
}

#[test]
fn applies_parameters_typed_as_the_config_declares_them() {
    let mut processor = TestProcessor::<Probe>::new()
        .parameter("gain", 0.5)
        .parameters(|p| p.steps = -2)
        .build();
    assert_eq!(processor.parameters().gain, 0.5);
    assert_eq!(processor.parameters().mode, Mode::Warm);
    assert_eq!(processor.parameters().steps, -2);
    let output = processor.process(&[vec![1.0, 0.5, -1.0], vec![0.25, 0.0, -0.25]]);
    assert_eq!(output, [vec![0.5, 0.25, -0.5], vec![0.125, 0.0, -0.125]]);

    processor.set_parameter("mode", 2.0);
    processor.set_parameter("gain", 2.0);
    let clipped = processor.process(&[vec![1.0, 0.1, -1.0]]);
    assert_eq!(clipped[0], [0.5, 0.2, -0.5]);
    assert_eq!(
        clipped[1],
        [0.0, 0.0, 0.0],
        "a missing input channel is silent"
    );

    processor.set_parameter("bypass", 1.0);
    processor.set_parameter("mode", 0.0);
    assert_eq!(processor.process(&[vec![0.75]])[0], [0.75]);
}

#[test]
#[should_panic(expected = "declares no parameter 'volume'")]
fn refuses_parameters_the_config_does_not_declare() {
    let _ = TestProcessor::<Probe>::new().parameter("volume", 1.0);
}

#[test]
#[should_panic(expected = "is not a value of parameter 'gain'")]
fn refuses_values_out_of_range() {
    let _ = TestProcessor::<Probe>::new().parameter("gain", 3.0);
}

#[test]
#[should_panic(expected = "whole")]
fn refuses_fractions_of_whole_parameters() {
    let _ = TestProcessor::<Probe>::new().parameter("steps", 0.5);
}

#[test]
fn splits_input_into_blocks_of_the_block_size() {
    let mut processor = TestProcessor::<Probe>::new().block_size(64).build();
    let input = ramp(200);
    let output = processor.process(&[input.clone(), input.clone()]);
    assert_eq!(processor.processor().blocks, [64, 64, 64, 8]);
    assert_eq!(output[0], input, "unity gain");
}

#[test]
fn processes_empty_blocks() {
    let mut processor = TestProcessor::<Probe>::new().build();
    assert_eq!(processor.process_silence(0), Status::Ok);
    assert_eq!(processor.processor().blocks, [0]);
}

#[test]
fn publishes_read_only_parameters_and_streams() {
    let mut processor = TestProcessor::<Probe>::new().parameter("gain", 1.0).build();
    processor.process(&[vec![0.5, -0.25]]);
    let peak = processor.parameters().peak;
    assert!((peak - 20.0 * 0.5f32.log10()).abs() < 1e-4, "{peak}");
    assert_eq!(processor.stream("level"), Some(0.5));
    assert_eq!(
        processor.stream_buffer::<f32>("history"),
        Some(vec![0.5, 0.25])
    );
    assert_eq!(processor.stream("missing"), None);
}

#[test]
fn passes_the_transport() {
    let mut processor = TestProcessor::<Probe>::new().build();
    processor.transport_mut().tempo = Some(96.0);
    processor.process(&[vec![0.0]]);
    assert_eq!(processor.processor().tempo, Some(96.0));
}

#[test]
fn resets_and_prepares_again() {
    let mut processor = TestProcessor::<Probe>::new().build();
    processor.process(&[vec![0.5; 4]]);
    assert!(processor.processor().history != 0.0);
    assert_eq!(processor.reset(), Status::Ok);
    assert_eq!(processor.processor().resets, 1);
    assert_eq!(processor.processor().history, 0.0);
    assert_eq!(processor.prepare(96_000.0, 128), Status::Ok);
    assert_eq!(processor.processor().prepared.len(), 2);
    assert_eq!(processor.processor().prepared[1].0, 96_000.0);
}

#[test]
fn instances_are_independent() {
    let mut quiet = TestProcessor::<Probe>::new().parameter("gain", 0.0).build();
    let mut loud = TestProcessor::<Probe>::new().parameter("gain", 2.0).build();
    assert_eq!(quiet.process(&[vec![0.25]])[0], [0.0]);
    assert_eq!(loud.process(&[vec![0.25]])[0], [0.5]);
    assert_eq!(quiet.processor().blocks.len(), 1);
}

#[test]
fn a_panic_silences_the_processor_until_it_is_prepared_again() {
    let mut processor = TestProcessor::<Probe>::new().build();
    processor.processor_mut().panic_in_process = true;
    assert_eq!(
        processor.try_process_buses(&[&[&[1.0]]]).unwrap_err(),
        Status::Panicked
    );
    assert!(processor.has_failed());
    assert_eq!(processor.process_silence(4), Status::Failed);
    assert_eq!(processor.reset(), Status::Failed);
    // Preparing replaces the failed processor with a new one.
    assert_eq!(processor.prepare(48_000.0, 512), Status::Ok);
    assert!(!processor.has_failed());
    assert!(!processor.processor().panic_in_process);
    assert_eq!(processor.process(&[vec![1.0]])[0], [1.0]);
}

#[test]
fn refuses_to_prepare_invalid_configurations() {
    let mut processor = TestProcessor::<Probe>::new().build();
    assert_eq!(processor.prepare(0.0, 512), Status::InvalidArgument);
    assert_eq!(processor.prepare(f64::NAN, 512), Status::InvalidArgument);
    assert_eq!(processor.prepare(48_000.0, 0), Status::InvalidArgument);
    assert_eq!(
        processor.prepare_with(48_000.0, 64, &[65], &[2]),
        Status::InvalidArgument
    );
}

#[test]
fn feeds_other_buses() {
    #[derive(Default)]
    struct Ducker;
    impl AudioProcessor for Ducker {
        fn prepare(&mut self, _: &PrepareContext) {}
        fn process(&mut self, ctx: &mut ProcessContext) {
            let frames = ctx.audio.frames();
            let mut key = [0.0f32; 8];
            if let Some(side) = ctx.audio.input(1).and_then(|bus| bus.channel(0)) {
                key[..frames].copy_from_slice(side);
            }
            for channel in ctx.audio.channels() {
                for (sample, key) in channel.iter_mut().zip(key) {
                    *sample *= 1.0 - key;
                }
            }
        }
    }
    let mut processor = TestProcessor::<Ducker>::new()
        .layout(&[1, 1], &[1])
        .block_size(8)
        .build();
    let output = processor.process_buses(&[&[&[1.0, 1.0]], &[&[0.25, 1.0]]]);
    assert_eq!(output, [vec![vec![0.75, 0.0]]]);
}

#[test]
fn starts_wider_outputs_silent() {
    #[derive(Default)]
    struct Pass;
    impl AudioProcessor for Pass {
        fn prepare(&mut self, _: &PrepareContext) {}
        fn process(&mut self, ctx: &mut ProcessContext) {
            assert_eq!(ctx.audio.channel_count(), 2);
            assert_eq!(ctx.audio.input(0).map(|bus| bus.channel_count()), Some(1));
            assert_eq!(ctx.audio.channel(1), Some(&[0.0, 0.0][..]));
        }
    }
    let mut processor = TestProcessor::<Pass>::new().layout(&[1, 0], &[2]).build();
    assert_eq!(
        processor.process(&[vec![0.5, 0.5]]),
        [vec![0.5, 0.5], vec![0.0, 0.0]]
    );
}
