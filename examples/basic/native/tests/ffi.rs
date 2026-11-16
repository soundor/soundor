//! The gain processor through its C ABI, the functions `soundor::export!`
//! defines and the JUCE runtime links, called with the structures it passes.

use soundor::ffi::{SoundorBlock, SoundorProcessorInfo};
use soundor::testing::{NativeProcessor, Status};
use soundor_basic::__soundor_exports::{self, exports};

const OK: i32 = Status::Ok as i32;

#[test]
fn reports_the_contract_it_was_built_from() {
    let mut info = SoundorProcessorInfo::default();
    // SAFETY: a valid structure.
    assert_eq!(
        unsafe { __soundor_exports::soundor_processor_info(&mut info) },
        0
    );
    assert_eq!(info.abi_version, soundor::ABI_VERSION);
    assert_eq!(info.parameter_count, 1, "gain");
    assert_eq!((info.published_count, info.stream_count), (0, 0));
}

#[test]
fn applies_the_gain_in_place() {
    let mut processor = NativeProcessor::new(exports());
    processor.parameters[0] = 0.5;
    assert_eq!(processor.prepare(48_000.0, 512, &[2], &[2]), OK);
    let mut channels = vec![vec![1.0, -1.0, 0.5], vec![0.25, 0.0, -0.25]];
    assert_eq!(processor.process_in_place(&mut channels, &[]), OK);
    assert_eq!(channels, [vec![0.5, -0.5, 0.25], vec![0.125, 0.0, -0.125]]);
}

#[test]
fn processes_mono_with_blocks_longer_than_prepared() {
    let mut processor = NativeProcessor::new(exports());
    processor.parameters[0] = 0.25;
    assert_eq!(processor.prepare(44_100.0, 64, &[1], &[1]), OK);
    let mut channels = vec![vec![1.0f32; 1000]];
    assert_eq!(processor.process_in_place(&mut channels, &[]), OK);
    assert!(channels[0].iter().all(|sample| *sample == 0.25));
}

#[test]
fn is_silent_before_prepare_and_after_an_invalid_block() {
    let mut processor = NativeProcessor::new(exports());
    let mut channels = vec![vec![1.0f32; 8]];
    assert_eq!(
        processor.process_in_place(&mut channels, &[]),
        Status::NotPrepared as i32
    );
    assert_eq!(channels[0], [0.0; 8]);
    assert_eq!(processor.prepare(48_000.0, 64, &[1], &[1]), OK);
    let mut samples = [1.0f32; 8];
    // One output where the layout has one input and one output.
    assert_eq!(
        processor.process_raw(8, &[], &[samples.as_mut_ptr()], None),
        Status::InvalidArgument as i32
    );
    // A block from another ABI.
    let outputs = [samples.as_mut_ptr()];
    let inputs = [outputs[0].cast_const()];
    let block = SoundorBlock {
        size: std::mem::size_of::<SoundorBlock>() as u32,
        abi_version: 0,
        frames: 8,
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
    };
    // SAFETY: valid pointers; only its version is wrong.
    assert_eq!(
        unsafe { processor.process_block(&block) },
        Status::AbiMismatch as i32
    );
}

#[test]
fn resets_through_the_abi() {
    let mut processor = NativeProcessor::new(exports());
    assert_eq!(processor.reset(), Status::NotPrepared as i32);
    assert_eq!(processor.prepare(48_000.0, 64, &[2], &[2]), OK);
    assert_eq!(processor.reset(), OK);
}

#[test]
fn instances_are_independent() {
    let mut half = NativeProcessor::new(exports());
    let mut zero = NativeProcessor::new(exports());
    half.parameters[0] = 0.5;
    zero.parameters[0] = 0.0;
    // Prepared with these values, they apply from the first sample.
    assert_eq!(half.prepare(48_000.0, 64, &[1], &[1]), OK);
    assert_eq!(zero.prepare(48_000.0, 64, &[1], &[1]), OK);
    let mut a = vec![vec![1.0f32; 4]];
    let mut b = vec![vec![1.0f32; 4]];
    assert_eq!(half.process_in_place(&mut a, &[]), OK);
    assert_eq!(zero.process_in_place(&mut b, &[]), OK);
    assert_eq!((a[0][0], b[0][0]), (0.5, 0.0));
}
