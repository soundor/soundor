//! The C ABI `soundor::export!` defines, called as a native runtime calls it.

use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, Ordering};

use soundor::ffi::{SoundorBlock, SoundorStreamSink};
use soundor::prelude::*;
use soundor::testing::{NativeProcessor, Status};

#[derive(Default)]
struct Gain {
    max_frames: usize,
    largest_block: usize,
}

impl AudioProcessor for Gain {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.max_frames = ctx.max_frames;
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        assert!(ctx.audio.frames() <= self.max_frames);
        self.largest_block = self.largest_block.max(ctx.audio.frames());
        let gain = ctx.params.gain;
        if gain > 1.9 {
            panic!("too loud");
        }
        for channel in ctx.audio.channels() {
            for sample in channel {
                *sample *= gain;
            }
        }
        ctx.publish.peak(-6.0);
        ctx.streams.level.publish(gain);
        let buffer = ctx.streams.history.buffer_mut();
        if let Some(first) = buffer.first_mut() {
            *first = gain;
        }
        ctx.streams.history.commit(1);
    }
}

soundor::export!(Gain);

fn native() -> NativeProcessor {
    NativeProcessor::new(__soundor_exports::exports())
}

const OK: i32 = Status::Ok as i32;

#[test]
fn reports_what_it_was_built_from() {
    let mut info = soundor::ffi::SoundorProcessorInfo::default();
    // SAFETY: a valid structure.
    assert_eq!(
        unsafe { __soundor_exports::soundor_processor_info(&mut info) },
        0
    );
    assert_eq!(info.abi_version, soundor::ABI_VERSION);
    assert_eq!(info.parameter_count, 5);
    assert_eq!(info.published_count, 1);
    assert_eq!(info.stream_count, 2);
    // SAFETY: null is allowed.
    assert_eq!(
        unsafe { __soundor_exports::soundor_processor_info(std::ptr::null_mut()) },
        1
    );
}

#[test]
fn processes_in_place_through_the_exports() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 64, &[2, 0], &[2]), OK);
    processor.parameters[0] = 0.5;
    let mut channels = vec![vec![1.0, -1.0, 0.5], vec![0.0, 0.25, -0.5]];
    assert_eq!(processor.process_in_place(&mut channels, &[]), OK);
    assert_eq!(channels, [vec![0.5, -0.5, 0.25], vec![0.0, 0.125, -0.25]]);
    assert_eq!(processor.published, [-6.0]);
}

#[test]
fn copies_separate_inputs_into_the_outputs() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 64, &[1, 0], &[2]), OK);
    processor.parameters[0] = 2.0 / 4.0;
    let input = [0.5f32, 1.0];
    let mut left = [9.0f32; 2];
    let mut right = [9.0f32; 2];
    let status = processor.process_raw(
        2,
        &[input.as_ptr()],
        &[left.as_mut_ptr(), right.as_mut_ptr()],
        None,
    );
    assert_eq!(status, OK);
    assert_eq!(left, [0.25, 0.5]);
    assert_eq!(
        right,
        [0.0, 0.0],
        "an output without an input starts silent"
    );
}

#[test]
fn splits_blocks_longer_than_prepared() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    processor.parameters[0] = 1.0;
    let mut channels = vec![(0..100).map(|i| i as f32).collect::<Vec<_>>()];
    assert_eq!(processor.process_in_place(&mut channels, &[]), OK);
    assert_eq!(channels[0], (0..100).map(|i| i as f32).collect::<Vec<_>>());
}

#[test]
fn processes_empty_blocks_with_null_buffers() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    let status = processor.process_raw(0, &[std::ptr::null()], &[std::ptr::null_mut()], None);
    assert_eq!(status, OK);
}

#[test]
fn refuses_invalid_blocks() {
    let mut processor = native();
    let mut samples = [1.0f32; 4];
    assert_eq!(
        processor.process_raw(4, &[], &[samples.as_mut_ptr()], None),
        Status::NotPrepared as i32,
        "before prepare"
    );
    assert_eq!(samples, [0.0; 4], "silenced");
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    let mut output = [1.0f32; 4];
    // Wrong channel counts.
    assert_eq!(
        processor.process_raw(4, &[], &[output.as_mut_ptr()], None),
        Status::InvalidArgument as i32
    );
    // A null channel.
    assert_eq!(
        processor.process_raw(4, &[output.as_ptr()], &[std::ptr::null_mut()], None),
        Status::InvalidArgument as i32
    );
    // An input overlapping an output it is not processed in place with.
    let mut shared = [0.5f32; 8];
    let base = shared.as_mut_ptr();
    assert_eq!(
        processor.process_raw(4, &[base.wrapping_add(2).cast_const()], &[base], None),
        Status::InvalidArgument as i32
    );
    // Misaligned.
    let misaligned = (base as usize + 1) as *mut f32;
    assert_eq!(
        processor.process_raw(2, &[misaligned.cast_const()], &[misaligned], None),
        Status::InvalidArgument as i32
    );
    // A non-finite parameter.
    processor.parameters[0] = f64::NAN;
    assert_eq!(
        processor.process_raw(4, &[output.as_ptr()], &[output.as_mut_ptr()], None),
        Status::InvalidArgument as i32
    );
}

#[test]
fn refuses_other_abis_and_null_arguments() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    let mut output = [1.0f32; 4];
    let outputs = [output.as_mut_ptr()];
    let inputs = [outputs[0].cast_const()];
    let block = SoundorBlock {
        size: std::mem::size_of::<SoundorBlock>() as u32,
        abi_version: soundor::ABI_VERSION + 1,
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
        state_size: 0,
        state: std::ptr::null(),
    };
    // SAFETY: valid pointers; only the version is wrong.
    assert_eq!(
        unsafe { processor.process_block(&block) },
        Status::AbiMismatch as i32
    );
    let current = SoundorBlock {
        abi_version: soundor::ABI_VERSION,
        ..block
    };
    // SAFETY: a valid block, without parameters (the last ones stay).
    assert_eq!(unsafe { processor.process_block(&current) }, OK);
    // SAFETY: null handles and blocks are refused, never dereferenced.
    unsafe {
        assert_eq!(
            __soundor_exports::soundor_processor_process(processor.handle(), std::ptr::null()),
            Status::InvalidArgument as i32
        );
        assert_eq!(
            __soundor_exports::soundor_processor_process(std::ptr::null_mut(), &current),
            Status::InvalidArgument as i32
        );
        assert_eq!(
            __soundor_exports::soundor_processor_prepare(processor.handle(), std::ptr::null()),
            Status::InvalidArgument as i32
        );
        assert_eq!(
            __soundor_exports::soundor_processor_reset(std::ptr::null_mut()),
            Status::InvalidArgument as i32
        );
        __soundor_exports::soundor_processor_destroy(std::ptr::null_mut());
    }
}

#[test]
fn contains_panics() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    processor.parameters[0] = 2.0;
    let mut channels = vec![vec![1.0f32; 4]];
    assert_eq!(
        processor.process_in_place(&mut channels, &[]),
        Status::Panicked as i32
    );
    assert_eq!(channels[0], [0.0; 4]);
    processor.parameters[0] = 1.0;
    channels[0].fill(1.0);
    assert_eq!(
        processor.process_in_place(&mut channels, &[]),
        Status::Failed as i32
    );
    assert_eq!(channels[0], [0.0; 4]);
    assert_eq!(processor.reset(), Status::Failed as i32);
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    channels[0].fill(1.0);
    assert_eq!(processor.process_in_place(&mut channels, &[]), OK);
    assert_eq!(channels[0], [1.0; 4]);
}

static PUBLISHED: AtomicU32 = AtomicU32::new(0);
static mut HISTORY: [f32; 8] = [0.0; 8];
static COMMITTED: AtomicU32 = AtomicU32::new(u32::MAX);

// Streams are in name order: `history` is 0, `level` 1.
unsafe extern "C" fn publish(_: *mut c_void, index: u32, value: f64) {
    assert_eq!(index, 1);
    PUBLISHED.store((value as f32).to_bits(), Ordering::SeqCst);
}

unsafe extern "C" fn buffer(_: *mut c_void, index: u32, capacity: *mut u32) -> *mut c_void {
    assert_eq!(index, 0);
    // SAFETY: the processor passes a valid pointer.
    unsafe { *capacity = 8 };
    (&raw mut HISTORY).cast()
}

unsafe extern "C" fn commit(_: *mut c_void, index: u32, length: u32) {
    assert_eq!(index, 0);
    COMMITTED.store(length, Ordering::SeqCst);
}

#[test]
fn publishes_streams_through_the_runtime_callbacks() {
    let mut processor = native();
    assert_eq!(processor.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    processor.parameters[0] = 0.75;
    let mut samples = [0.0f32; 4];
    let sink = SoundorStreamSink {
        user: std::ptr::null_mut(),
        publish: Some(publish),
        buffer: Some(buffer),
        commit: Some(commit),
    };
    let status =
        processor.process_raw(4, &[samples.as_ptr()], &[samples.as_mut_ptr()], Some(&sink));
    assert_eq!(status, OK);
    assert_eq!(f32::from_bits(PUBLISHED.load(Ordering::SeqCst)), 0.75);
    assert_eq!(COMMITTED.load(Ordering::SeqCst), 1);
    // SAFETY: the processor is done with it.
    assert_eq!(unsafe { HISTORY[0] }, 0.75);
}

#[test]
fn instances_are_independent() {
    let mut first = native();
    let mut second = native();
    assert_eq!(first.prepare(48_000.0, 16, &[1, 0], &[1]), OK);
    assert_eq!(second.prepare(44_100.0, 16, &[1, 0], &[1]), OK);
    first.parameters[0] = 0.5;
    second.parameters[0] = 0.0;
    let mut a = vec![vec![1.0f32]];
    let mut b = vec![vec![1.0f32]];
    assert_eq!(first.process_in_place(&mut a, &[]), OK);
    assert_eq!(second.process_in_place(&mut b, &[]), OK);
    assert_eq!((a[0][0], b[0][0]), (0.5, 0.0));
}
