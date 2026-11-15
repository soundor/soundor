//! The WebAssembly glue, natively: the calls the Web runtime's AudioWorklet
//! makes, through `WasmHandle`.

use soundor::prelude::*;
use soundor::wasm::{Status, WasmHandle};

#[derive(Default)]
struct Gain;

impl AudioProcessor for Gain {
    fn prepare(&mut self, _: &PrepareContext) {}
    fn process(&mut self, ctx: &mut ProcessContext) {
        let gain = ctx.params.gain;
        for channel in ctx.audio.channels() {
            for sample in channel {
                *sample *= gain;
            }
        }
        ctx.publish.peak(-12.0);
        ctx.channels.level.publish(gain);
        ctx.channels
            .history
            .publish(&[gain, ctx.transport.tempo.unwrap_or(0.0) as f32]);
    }
}

fn write(pointer: *mut f32, samples: &[f32]) {
    // SAFETY: a channel of at least `samples.len()` frames.
    unsafe { std::ptr::copy_nonoverlapping(samples.as_ptr(), pointer, samples.len()) };
}

fn read(pointer: *mut f32, frames: usize) -> Vec<f32> {
    // SAFETY: as `write`.
    unsafe { std::slice::from_raw_parts(pointer, frames) }.to_vec()
}

#[test]
fn processes_in_place_in_its_own_memory() {
    let mut handle = WasmHandle::<Gain>::new();
    handle.layout()[..5].copy_from_slice(&[2, 1, 2, 0, 2]);
    handle.parameters()[0] = 0.5;
    assert_eq!(handle.prepare(48_000.0, 128), Status::Ok);
    // Main input channels are their outputs' memory; there is no sidechain.
    assert_eq!(handle.input(0), handle.output(0));
    assert_eq!(handle.input(1), handle.output(1));
    assert!(handle.input(2).is_null());
    write(handle.input(0), &[1.0, -1.0, 0.5]);
    write(handle.input(1), &[0.25, 0.0, -0.25]);
    assert_eq!(handle.process(3), Status::Ok);
    assert_eq!(read(handle.output(0), 3), [0.5, -0.5, 0.25]);
    assert_eq!(read(handle.output(1), 3), [0.125, 0.0, -0.125]);
    assert_eq!(handle.published(), [-12.0]);
}

#[test]
fn reports_channel_changes_once() {
    let mut handle = WasmHandle::<Gain>::new();
    handle.parameters()[0] = 0.75;
    handle.transport()[0] = 140.0;
    assert_eq!(handle.prepare(48_000.0, 64), Status::Ok);
    assert_eq!(handle.process(8), Status::Ok);
    // `history` (0) holds two elements; `level` (1) is a number.
    assert_eq!(handle.take_channel_change(0), 3);
    assert_eq!(handle.take_channel_change(1), 1);
    assert_eq!(handle.take_channel_change(1), 0);
    assert_eq!(handle.channel_value(1), 0.75);
    // SAFETY: two f32s were committed.
    let history = unsafe { std::slice::from_raw_parts(handle.channel_buffer(0).cast::<f32>(), 2) };
    assert_eq!(history, [0.75, 140.0]);
}

#[test]
fn widens_mono_to_stereo_and_reads_a_sidechain() {
    let mut handle = WasmHandle::<Gain>::new();
    handle.layout()[..5].copy_from_slice(&[2, 1, 1, 1, 2]);
    handle.parameters()[0] = 1.0;
    assert_eq!(handle.prepare(44_100.0, 16), Status::Ok);
    assert_eq!(handle.input(0), handle.output(0));
    assert_ne!(
        handle.input(1),
        handle.output(1),
        "the sidechain has its own memory"
    );
    write(handle.input(0), &[0.5; 4]);
    write(handle.input(1), &[0.9; 4]);
    write(handle.output(1), &[7.0; 4]);
    assert_eq!(handle.process(4), Status::Ok);
    assert_eq!(
        read(handle.output(1), 4),
        [0.0; 4],
        "a widened channel starts silent"
    );
}

#[test]
fn refuses_blocks_longer_than_prepared_and_invalid_layouts() {
    let mut handle = WasmHandle::<Gain>::new();
    assert_eq!(handle.process(8), Status::NotPrepared);
    assert_eq!(handle.prepare(48_000.0, 32), Status::Ok);
    assert_eq!(handle.process(33), Status::InvalidArgument);
    assert_eq!(handle.process(0), Status::Ok);
    handle.layout()[0] = 1000;
    assert_eq!(handle.prepare(48_000.0, 32), Status::InvalidArgument);
    handle.layout()[0] = 1;
    handle.parameters()[0] = f64::NAN;
    assert_eq!(handle.prepare(48_000.0, 32), Status::InvalidArgument);
}

#[test]
fn resets_and_is_independent() {
    let mut a = WasmHandle::<Gain>::new();
    let mut b = WasmHandle::<Gain>::new();
    a.parameters()[0] = 0.5;
    b.parameters()[0] = 0.0;
    assert_eq!(a.prepare(48_000.0, 8), Status::Ok);
    assert_eq!(b.prepare(48_000.0, 8), Status::Ok);
    write(a.input(0), &[1.0; 2]);
    write(b.input(0), &[1.0; 2]);
    assert_eq!((a.process(2), b.process(2)), (Status::Ok, Status::Ok));
    assert_eq!(
        (read(a.output(0), 2), read(b.output(0), 2)),
        (vec![0.5; 2], vec![0.0; 2])
    );
    assert_eq!(a.reset(), Status::Ok);
}
