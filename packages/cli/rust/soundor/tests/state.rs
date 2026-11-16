//! The persistent state the processing reads (`ctx.state`): its generated
//! type, its defaults, how changes reach blocks, and the C ABI that passes
//! it.

use soundor::ffi::{SoundorBlock, SoundorPrepare};
use soundor::prelude::*;
use soundor::testing::{CountingAllocator, NativeProcessor, Status, TestProcessor};

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// Records what `prepare` and each block saw of the state.
#[derive(Default)]
struct Recorder {
    prepared: Option<(i32, Vec<i32>)>,
    modes: Vec<i32>,
    patterns: Vec<Vec<i32>>,
    depth: f64,
    enabled: bool,
    seed: u64,
    weights: Vec<f32>,
    // Preallocated in `prepare`, so that `process` never allocates.
    last_pattern: [i32; 8],
    last_length: usize,
}

impl Processor for Recorder {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.prepared = Some((ctx.state.processing_mode, ctx.state.pattern.to_vec()));
        self.modes.reserve(64);
        self.patterns.reserve(64);
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let state = ctx.state;
        self.last_length = state.pattern.len();
        self.last_pattern[..state.pattern.len()].copy_from_slice(&state.pattern);
        self.depth = state.depth;
        self.enabled = state.enabled;
        self.seed = state.seed;
        if self.modes.len() < self.modes.capacity() {
            self.modes.push(state.processing_mode);
        }
        if self.weights.capacity() >= state.weights.len() {
            self.weights.clear();
            self.weights.extend_from_slice(&state.weights);
        }
    }
}

impl Recorder {
    fn pattern(&self) -> &[i32] {
        &self.last_pattern[..self.last_length]
    }
}

#[path = "support/controller.rs"]
mod controller;
use controller::PluginController;
soundor::export!(Recorder, PluginController);

#[test]
fn has_the_audio_fields_only_with_the_configs_defaults() {
    let defaults = TestProcessor::<Recorder>::new().build();
    let state = defaults.state();
    assert_eq!(state.processing_mode, 1);
    assert!(state.enabled);
    assert_eq!(state.depth, 0.25);
    assert_eq!(state.seed, 7);
    assert_eq!(&*state.pattern, &[60, 64, 67]);
    assert!(state.weights.is_empty());
    assert_eq!(soundor::STATE_SIZE, std::mem::size_of::<StateSnapshot>());
    assert_eq!(StateArray::<i32, 8>::CAPACITY, 8);
}

#[test]
fn prepare_and_every_block_read_the_current_state() {
    let mut processor = TestProcessor::<Recorder>::new().block_size(64).build();
    assert_eq!(processor.processor().prepared, Some((1, vec![60, 64, 67])));
    processor.process(&[vec![0.0; 64], vec![0.0; 64]]);
    assert_eq!(processor.processor().pattern(), [60, 64, 67]);

    // A change reaches the next block, and every block after.
    processor.state_mut().processing_mode = 2;
    processor.state_mut().depth = -1.5;
    processor.state_mut().seed = u64::MAX;
    processor.state_mut().enabled = false;
    processor.process(&[vec![0.0; 128], vec![0.0; 128]]);
    assert_eq!(processor.processor().modes, [1, 2, 2]);
    assert_eq!(processor.processor().depth, -1.5);
    assert_eq!(processor.processor().seed, u64::MAX);
    assert!(!processor.processor().enabled);
}

#[test]
fn arrays_hold_any_length_up_to_their_capacity() {
    let mut processor = TestProcessor::<Recorder>::new().build();
    for values in [&[][..], &[1][..], &[1, 2, 3, 4, 5, 6, 7, 8][..]] {
        assert!(processor.state_mut().pattern.set(values));
        processor.process_silence(32);
        assert_eq!(processor.processor().pattern(), values);
    }
    // More than maxLength changes nothing.
    assert!(!processor.state_mut().pattern.set(&[0; 9]));
    assert_eq!(processor.state().pattern.len(), 8);
    processor.state_mut().pattern.clear();
    processor.process_silence(32);
    assert!(processor.processor().pattern().is_empty());
}

#[test]
fn reading_the_state_allocates_nothing() {
    let mut processor = TestProcessor::<Recorder>::new().block_size(64).build();
    processor.state_mut().pattern.set(&[3, 2, 1]);
    for _ in 0..16 {
        processor.process_silence(64);
    }
    assert_eq!(processor.allocations(), 0);
    assert_eq!(processor.processor().pattern(), [3, 2, 1]);
}

fn native() -> NativeProcessor {
    NativeProcessor::new(__soundor_exports::exports())
}

#[test]
fn the_c_abi_passes_the_state_to_prepare_and_each_block() {
    let mut info = soundor::ffi::SoundorProcessorInfo::default();
    // SAFETY: a valid structure.
    unsafe { __soundor_exports::soundor_processor_info(&mut info) };
    assert_eq!(info.state_size as usize, soundor::STATE_SIZE);

    let mut processor = native();
    processor.state.processing_mode = 5;
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), 0);
    processor.state.pattern.set(&[9, 8]);
    let mut samples = vec![vec![0.0f32; 16]];
    assert_eq!(processor.process_in_place(&mut samples, &[]), 0);
    assert_eq!(processor.allocations(), 0);
}

#[test]
fn the_c_abi_refuses_a_state_of_another_size_or_alignment() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), 0);
    let mut output = [0.0f32; 4];
    let outputs = [output.as_mut_ptr()];
    let inputs = [outputs[0].cast_const()];
    let state = StateSnapshotBytes([0; soundor::STATE_SIZE / 8 + 1]);
    let block = |state: *const u8, size: usize| SoundorBlock {
        size: std::mem::size_of::<SoundorBlock>() as u32,
        abi_version: soundor::ABI_VERSION,
        frames: 4,
        input_count: 1,
        inputs: inputs.as_ptr(),
        output_count: 1,
        outputs: outputs.as_ptr(),
        parameter_count: 0,
        parameters: std::ptr::null(),
        published_count: 0,
        published: std::ptr::null_mut(),
        transport: std::ptr::null(),
        streams: std::ptr::null(),
        state_size: size as u32,
        state: state.cast(),
    };
    let base = state.0.as_ptr().cast::<u8>();
    // SAFETY: every block's pointers are valid; the state's size or
    // alignment is what the processor refuses, without reading it.
    unsafe {
        assert_eq!(
            processor.process_block(&block(base, soundor::STATE_SIZE - 8)),
            Status::InvalidArgument as i32
        );
        assert_eq!(
            processor.process_block(&block(base.add(1), soundor::STATE_SIZE)),
            Status::InvalidArgument as i32
        );
        // Null is the config's defaults.
        assert_eq!(processor.process_block(&block(std::ptr::null(), 0)), 0);
    }
    let prepare = SoundorPrepare {
        size: std::mem::size_of::<SoundorPrepare>() as u32,
        abi_version: soundor::ABI_VERSION,
        sample_rate: 48_000.0,
        max_frames: 16,
        input_bus_count: 0,
        input_channels: std::ptr::null(),
        output_bus_count: 1,
        output_channels: [1u32].as_ptr(),
        parameter_count: 0,
        parameters: std::ptr::null(),
        state_size: 3,
        state: base.cast(),
    };
    // SAFETY: valid pointers; the state's size is wrong.
    assert_eq!(
        unsafe { __soundor_exports::soundor_processor_prepare(processor.handle(), &prepare) },
        Status::InvalidArgument as i32
    );
}

/// Storage aligned as the snapshot is, a little larger.
#[repr(align(8))]
struct StateSnapshotBytes([u64; soundor::STATE_SIZE / 8 + 1]);
