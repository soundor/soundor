//! The processor compiled to WebAssembly, as the Web runtime's AudioWorklet
//! runs it: the module exports `soundor_wasm_*` (defined by
//! [`export!`](crate::export) on `wasm32`), and the processor owns every
//! buffer in its own linear memory, so JavaScript only writes samples and
//! values at addresses it reads once after `prepare`.
//!
//! The order of calls:
//!
//! 1. `create`; write the layout (`layout`: input bus count, output bus count,
//!    then each bus's channels) and the parameters' plain values
//!    (`parameters`);
//! 2. `prepare(sample_rate, max_frames)`, which allocates the channels; read
//!    their addresses (`input`, `output`) and the other buffers' again, as
//!    memory may have grown;
//! 3. per block of at most `max_frames`: write each input channel's samples
//!    at `input(i)` (a main input channel processed in place is its output's
//!    address), the parameters and the transport, `process(frames)`, read the
//!    outputs at `output(i)`, `published`, and the channels that changed;
//! 4. `reset` between blocks; `destroy`.
//!
//! The module is single-threaded and never shares its memory. A panic aborts:
//! the call traps, and the runtime makes a new instance.
//!
//! The glue compiles on every target, so that its tests run natively.

use std::cell::{Cell, UnsafeCell};

use crate::ABI_VERSION;
use crate::channels::ChannelSink;
pub use crate::instance::Status;
use crate::instance::{Block, Instance, MAX_BUSES, MAX_FRAMES};
use crate::plugin::{CHANNELS, PUBLISHED, Parameters};
use crate::processor::AudioProcessor;
use crate::transport::Transport;

/// Slots of the transport, as `f64`s: tempo, time in seconds, position in
/// beats (NaN where unknown), playing (0 or 1), time signature numerator
/// and denominator (0 where unknown).
pub const TRANSPORT_SLOTS: usize = 6;

/// The latest value of each channel, for JavaScript to read after a block.
struct Mailbox {
    values: Vec<Cell<f64>>,
    // 0: unchanged; a number channel: 1; a buffer channel: its length + 1.
    changed: Vec<Cell<u32>>,
    // `u64`s: aligned for, and holding, `maxLength` elements of any type.
    buffers: Vec<UnsafeCell<Vec<u64>>>,
}

impl Mailbox {
    fn new() -> Self {
        Self {
            values: (0..CHANNELS.len()).map(|_| Cell::new(0.0)).collect(),
            changed: (0..CHANNELS.len()).map(|_| Cell::new(0)).collect(),
            buffers: CHANNELS
                .iter()
                .map(|(_, length)| UnsafeCell::new(vec![0; length.unwrap_or(0)]))
                .collect(),
        }
    }
}

impl ChannelSink for Mailbox {
    fn publish(&self, index: u32, value: f64) {
        if let (Some(slot), Some(changed)) = (
            self.values.get(index as usize),
            self.changed.get(index as usize),
        ) {
            slot.set(value);
            changed.set(1);
        }
    }

    fn buffer(&self, index: u32) -> (*mut u8, usize) {
        match self.buffers.get(index as usize) {
            // SAFETY: single-threaded; only the one handle of this channel
            // writes it, between JavaScript's reads.
            Some(buffer) => {
                let buffer = unsafe { &mut *buffer.get() };
                (buffer.as_mut_ptr().cast(), buffer.len())
            }
            None => (std::ptr::null_mut(), 0),
        }
    }

    fn commit(&self, index: u32, length: usize) {
        if let (Some(changed), Some(&(_, Some(capacity)))) = (
            self.changed.get(index as usize),
            CHANNELS.get(index as usize),
        ) {
            changed.set(length.min(capacity) as u32 + 1);
        }
    }
}

/// The processor behind a WebAssembly handle, with its buffers.
pub struct WasmHandle<P: AudioProcessor> {
    instance: Instance<P>,
    layout: [u32; 2 + 2 * MAX_BUSES],
    max_frames: usize,
    inputs: Vec<usize>,
    outputs: Vec<usize>,
    storage: Vec<f32>,
    input_pointers: Vec<*const f32>,
    output_pointers: Vec<*mut f32>,
    parameters: [f64; Parameters::COUNT],
    published: [f64; PUBLISHED.len()],
    transport: [f64; TRANSPORT_SLOTS],
    mailbox: Mailbox,
}

impl<P: AudioProcessor> WasmHandle<P> {
    /// A processor with the config's default parameter values, stereo in and
    /// out until the layout is written.
    pub fn new() -> Self {
        let mut parameters = [0.0; Parameters::COUNT];
        Parameters::default().write(&mut parameters);
        let mut layout = [0; 2 + 2 * MAX_BUSES];
        layout[..4].copy_from_slice(&[1, 1, 2, 2]);
        Self {
            instance: Instance::new(),
            layout,
            max_frames: 0,
            inputs: Vec::new(),
            outputs: Vec::new(),
            storage: Vec::new(),
            input_pointers: Vec::new(),
            output_pointers: Vec::new(),
            parameters,
            published: [f64::NAN; PUBLISHED.len()],
            transport: [f64::NAN, f64::NAN, f64::NAN, 0.0, 0.0, 0.0],
            mailbox: Mailbox::new(),
        }
    }

    /// The layout to write before `prepare`: `[inputs, outputs, channels of
    /// each input bus..., channels of each output bus...]`.
    pub fn layout(&mut self) -> &mut [u32] {
        &mut self.layout
    }

    /// The parameters' plain values, in the config's order.
    pub fn parameters(&mut self) -> &mut [f64] {
        &mut self.parameters
    }

    /// The transport (see [`TRANSPORT_SLOTS`]).
    pub fn transport(&mut self) -> &mut [f64] {
        &mut self.transport
    }

    /// What the last block published for each read-only parameter (NaN for
    /// none).
    pub fn published(&self) -> &[f64] {
        &self.published
    }

    /// The processor.
    pub fn processor(&self) -> &P {
        self.instance.processor()
    }

    /// Reads the layout, allocates `max_frames` samples for each output
    /// channel and each input channel not processed in place, and prepares.
    pub fn prepare(&mut self, sample_rate: f64, max_frames: u32) -> Status {
        let (input_buses, output_buses) = (self.layout[0] as usize, self.layout[1] as usize);
        let max_frames = max_frames as usize;
        if input_buses > MAX_BUSES
            || output_buses > MAX_BUSES
            || max_frames == 0
            || max_frames > MAX_FRAMES
        {
            return Status::InvalidArgument;
        }
        let counts = &self.layout[2..2 + input_buses + output_buses];
        let inputs: Vec<usize> = counts[..input_buses]
            .iter()
            .map(|&count| count as usize)
            .collect();
        let outputs: Vec<usize> = counts[input_buses..]
            .iter()
            .map(|&count| count as usize)
            .collect();
        let status = self.instance.prepare(
            sample_rate,
            max_frames,
            &inputs,
            &outputs,
            Some(&self.parameters),
        );
        if status != Status::Ok {
            return status;
        }
        let total_outputs: usize = outputs.iter().sum();
        let total_inputs: usize = inputs.iter().sum();
        let in_place = inputs
            .first()
            .copied()
            .unwrap_or(0)
            .min(outputs.first().copied().unwrap_or(0));
        self.storage = vec![0.0; (total_outputs + total_inputs - in_place) * max_frames];
        let base = self.storage.as_mut_ptr();
        self.output_pointers = (0..total_outputs)
            .map(|channel| base.wrapping_add(channel * max_frames))
            .collect();
        let mut next = total_outputs;
        self.input_pointers = (0..total_inputs)
            .map(|channel| {
                if channel < in_place {
                    self.output_pointers[channel].cast_const()
                } else {
                    next += 1;
                    base.wrapping_add((next - 1) * max_frames).cast_const()
                }
            })
            .collect();
        self.max_frames = max_frames;
        self.inputs = inputs;
        self.outputs = outputs;
        Status::Ok
    }

    /// Input channel `index`'s samples, in bus order: where JavaScript writes
    /// a block's input. Null when there is no such channel.
    pub fn input(&mut self, index: u32) -> *mut f32 {
        self.input_pointers
            .get(index as usize)
            .map_or(std::ptr::null_mut(), |pointer| pointer.cast_mut())
    }

    /// Output channel `index`'s samples, in bus order.
    pub fn output(&mut self, index: u32) -> *mut f32 {
        self.output_pointers
            .get(index as usize)
            .copied()
            .unwrap_or(std::ptr::null_mut())
    }

    /// Processes the first `frames` samples of every channel.
    pub fn process(&mut self, frames: u32) -> Status {
        let frames = frames as usize;
        if frames > self.max_frames && self.max_frames > 0 {
            return Status::InvalidArgument;
        }
        let known = |value: f64| value.is_finite().then_some(value);
        let [tempo, seconds, beats, playing, numerator, denominator] = self.transport;
        let transport = Transport {
            playing: playing != 0.0,
            tempo: known(tempo).filter(|tempo| *tempo > 0.0),
            time_signature: (numerator >= 1.0 && denominator >= 1.0)
                .then_some((numerator as u32, denominator as u32)),
            time_seconds: known(seconds),
            position_beats: known(beats),
        };
        let status = self.instance.process(Block {
            frames,
            inputs: &self.input_pointers,
            outputs: &self.output_pointers,
            parameters: Some(&self.parameters),
            transport,
            channels: &self.mailbox,
        });
        self.published.copy_from_slice(self.instance.published());
        status
    }

    /// Resets the processor.
    pub fn reset(&mut self) -> Status {
        self.instance.reset()
    }

    /// Whether channel `index` changed since this was last asked, and so
    /// what to read: 0 unchanged, 1 a number (`channel_value`), `n + 1` a
    /// buffer of `n` elements (`channel_buffer`).
    pub fn take_channel_change(&self, index: u32) -> u32 {
        self.mailbox
            .changed
            .get(index as usize)
            .map_or(0, |changed| changed.replace(0))
    }

    /// Number channel `index`'s latest value.
    pub fn channel_value(&self, index: u32) -> f64 {
        self.mailbox
            .values
            .get(index as usize)
            .map_or(f64::NAN, Cell::get)
    }

    /// Buffer channel `index`'s storage, of its element type.
    pub fn channel_buffer(&self, index: u32) -> *const u8 {
        self.mailbox.buffer(index).0.cast_const()
    }
}

impl<P: AudioProcessor> Default for WasmHandle<P> {
    fn default() -> Self {
        Self::new()
    }
}

/// The counts a runtime checks the module against.
pub fn contract() -> [u32; 4] {
    [
        ABI_VERSION,
        Parameters::COUNT as u32,
        PUBLISHED.len() as u32,
        CHANNELS.len() as u32,
    ]
}

/// Defines the module's `soundor_wasm_*` exports, for
/// [`export!`](crate::export).
#[doc(hidden)]
#[macro_export]
macro_rules! __export_wasm {
    ($processor:ty) => {
        /// The WebAssembly module's exports, as `soundor::export!` defines them.
        #[cfg(target_arch = "wasm32")]
        pub mod __soundor_wasm {
            use super::*;
            use $crate::wasm::WasmHandle;

            type __Exported = $processor;
            type __Handle = WasmHandle<__Exported>;

            fn handle<'a>(pointer: *mut __Handle) -> &'a mut __Handle {
                // SAFETY: JavaScript passes only what `soundor_wasm_create`
                // returned, until it destroys it; the module is single-threaded.
                unsafe { &mut *pointer }
            }

            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_contract(index: u32) -> u32 {
                $crate::wasm::contract()
                    .get(index as usize)
                    .copied()
                    .unwrap_or(0)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_create() -> *mut __Handle {
                ::std::boxed::Box::into_raw(::std::boxed::Box::new(__Handle::new()))
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_destroy(pointer: *mut __Handle) {
                if !pointer.is_null() {
                    // SAFETY: as `handle`, and never used again.
                    drop(unsafe { ::std::boxed::Box::from_raw(pointer) });
                }
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_layout(pointer: *mut __Handle) -> *mut u32 {
                handle(pointer).layout().as_mut_ptr()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_parameters(pointer: *mut __Handle) -> *mut f64 {
                handle(pointer).parameters().as_mut_ptr()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_transport(pointer: *mut __Handle) -> *mut f64 {
                handle(pointer).transport().as_mut_ptr()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_published(pointer: *mut __Handle) -> *const f64 {
                handle(pointer).published().as_ptr()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_prepare(
                pointer: *mut __Handle,
                sample_rate: f64,
                max_frames: u32,
            ) -> i32 {
                handle(pointer).prepare(sample_rate, max_frames) as i32
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_input(pointer: *mut __Handle, index: u32) -> *mut f32 {
                handle(pointer).input(index)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_output(pointer: *mut __Handle, index: u32) -> *mut f32 {
                handle(pointer).output(index)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_process(pointer: *mut __Handle, frames: u32) -> i32 {
                handle(pointer).process(frames) as i32
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_reset(pointer: *mut __Handle) -> i32 {
                handle(pointer).reset() as i32
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_channel_changed(
                pointer: *mut __Handle,
                index: u32,
            ) -> u32 {
                handle(pointer).take_channel_change(index)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_channel_value(
                pointer: *mut __Handle,
                index: u32,
            ) -> f64 {
                handle(pointer).channel_value(index)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_channel_buffer(
                pointer: *mut __Handle,
                index: u32,
            ) -> *const u8 {
                handle(pointer).channel_buffer(index)
            }
        }
    };
}
