//! The processor compiled to WebAssembly, as the Web runtime's AudioWorklet
//! runs it: the module exports `soundor_wasm_*` (defined by
//! [`export!`](crate::export) on `wasm32`), and the processor owns every
//! buffer in its own linear memory, so JavaScript only writes samples and
//! values at addresses it reads once after `prepare`.
//!
//! The order of calls:
//!
//! 1. `create`; write the layout (`layout`: input bus count, output bus count,
//!    then each bus's channels), the parameters' plain values
//!    (`parameters`) and the state the processor reads (`state`, `STATE_SIZE`
//!    bytes laid out as [`StateSnapshot`](crate::StateSnapshot), the config's
//!    defaults until written);
//! 2. `prepare(sample_rate, max_frames)`, which allocates the channels; read
//!    their addresses (`input`, `output`) and the other buffers' again, as
//!    memory may have grown;
//! 3. per block of at most `max_frames`: write each input channel's samples
//!    at `input(i)` (a main input channel processed in place is its output's
//!    address), the parameters, the transport and the state when it changed,
//!    `process(frames)`, read the
//!    outputs at `output(i)`, `published`, and the streams that changed;
//! 4. `reset` between blocks; `destroy`.
//!
//! The module is single-threaded and never shares its memory. A panic aborts:
//! the call traps, and the runtime makes a new instance.
//!
//! The glue compiles on every target, so that its tests run natively.

use std::cell::{Cell, UnsafeCell};

use crate::ABI_VERSION;
pub use crate::instance::Status;
use crate::instance::{Block, Instance, MAX_BUSES, MAX_FRAMES};
use crate::plugin::{PUBLISHED, Parameters, STATE_SIZE, STREAMS, StateSnapshot};
use crate::processor::Processor;
use crate::streams::StreamSink;
use crate::transport::Transport;

/// Slots of the transport, as `f64`s: tempo, time in seconds, position in
/// beats (NaN where unknown), playing (0 or 1), time signature numerator
/// and denominator (0 where unknown).
pub const TRANSPORT_SLOTS: usize = 6;

/// The latest value of each stream, for JavaScript to read after a block.
struct Mailbox {
    values: Vec<Cell<f64>>,
    // 0: unchanged; a number stream: 1; a buffer stream: its length + 1.
    changed: Vec<Cell<u32>>,
    // `u64`s: aligned for, and holding, `maxLength` elements of any type.
    buffers: Vec<UnsafeCell<Vec<u64>>>,
}

impl Mailbox {
    fn new() -> Self {
        Self {
            values: (0..STREAMS.len()).map(|_| Cell::new(0.0)).collect(),
            changed: (0..STREAMS.len()).map(|_| Cell::new(0)).collect(),
            buffers: STREAMS
                .iter()
                .map(|(_, length)| UnsafeCell::new(vec![0; length.unwrap_or(0)]))
                .collect(),
        }
    }
}

impl StreamSink for Mailbox {
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
            // SAFETY: single-threaded; only the one handle of this stream
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
            STREAMS.get(index as usize),
        ) {
            changed.set(length.min(capacity) as u32 + 1);
        }
    }
}

/// The processor behind a WebAssembly handle, with its buffers.
pub struct WasmHandle<P: Processor> {
    instance: Instance<P>,
    midi_output: Box<[crate::midi_ffi::WireMidiEvent; crate::midi::MIDI_CAPACITY]>,
    midi_publications: Box<[crate::midi_ffi::WireMidiEvent; crate::midi::MIDI_CAPACITY]>,
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
    state: Box<StateSnapshot>,
    #[cfg(target_arch = "wasm32")]
    resource_input: Vec<u8>,
}

impl<P: Processor> WasmHandle<P> {
    /// A processor with the config's default parameter values, stereo in and
    /// out until the layout is written.
    pub fn new() -> Self {
        let mut parameters = [0.0; Parameters::COUNT];
        Parameters::default().write(&mut parameters);
        let mut layout = [0; 2 + 2 * MAX_BUSES];
        layout[..4].copy_from_slice(&[1, 1, 2, 2]);
        Self {
            instance: Instance::new(),
            midi_output: Box::new(
                [crate::midi_ffi::WireMidiEvent::default(); crate::midi::MIDI_CAPACITY],
            ),
            midi_publications: Box::new(
                [crate::midi_ffi::WireMidiEvent::default(); crate::midi::MIDI_CAPACITY],
            ),
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
            state: StateSnapshot::boxed_defaults(),
            #[cfg(target_arch = "wasm32")]
            resource_input: Vec::new(),
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

    /// The state the processor reads: `STATE_SIZE` bytes where JavaScript
    /// writes a [`StateSnapshot`] between calls, with its layout.
    pub fn state(&mut self) -> *mut u8 {
        std::ptr::from_mut::<StateSnapshot>(&mut self.state).cast()
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

    /// Inject one wire event between processing calls. 0 accepted, 1 full, 3 invalid.
    pub fn midi_input(&mut self, offset: u32, bytes: u32, source: u32) -> i32 {
        if source > 3 || bytes > 0xffffff {
            return 3;
        }
        let wire = crate::midi_ffi::WireMidiEvent {
            sample_offset: offset,
            bytes: [bytes as u8, (bytes >> 8) as u8, (bytes >> 16) as u8],
            source: source as u8,
        };
        let Ok(event) = wire.decode() else {
            self.instance.midi.recovery = true;
            return 3;
        };
        if self.instance.midi.input.push(event).is_err() {
            self.instance.midi.recovery = true;
            return 1;
        }
        0
    }
    /// Fixed output/publication storage, populated without allocation during process.
    pub fn midi_data(&self, publication: bool) -> *const crate::midi_ffi::WireMidiEvent {
        if publication {
            self.midi_publications.as_ptr()
        } else {
            self.midi_output.as_ptr()
        }
    }
    /// Records in the most recent block's fixed storage.
    pub fn midi_count(&self, publication: bool) -> usize {
        if publication {
            self.instance.midi.publication.events().len()
        } else {
            self.instance.midi.output.events().len()
        }
    }
    /// Reset generation for host and observer recovery.
    pub fn midi_generation(&self) -> u64 {
        self.instance.midi.generation()
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
            Some(&self.state),
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
            streams: &self.mailbox,
            state: Some(&self.state),
        });
        for (wire, event) in self
            .midi_output
            .iter_mut()
            .zip(self.instance.midi.output.events())
        {
            *wire = crate::midi_ffi::WireMidiEvent::encode(*event);
        }
        for (wire, event) in self
            .midi_publications
            .iter_mut()
            .zip(self.instance.midi.publication.events())
        {
            *wire = crate::midi_ffi::WireMidiEvent::encode(*event);
        }
        self.published.copy_from_slice(self.instance.published());
        status
    }

    #[cfg(target_arch = "wasm32")]
    #[doc(hidden)]
    pub fn resource_input(&mut self, length: usize) -> *mut u8 {
        self.resource_input.resize(length, 0);
        self.resource_input.as_mut_ptr()
    }

    #[cfg(target_arch = "wasm32")]
    #[doc(hidden)]
    pub fn publish_resource(&self, index: u32) -> i32 {
        let slots = self.instance.resource_slots();
        if slots.publish_wire(index, &self.resource_input).is_err() {
            return 1;
        }
        slots.collect();
        0
    }

    /// Resets the processor.
    pub fn reset(&mut self) -> Status {
        self.instance.reset()
    }

    /// Whether stream `index` changed since this was last asked, and so
    /// what to read: 0 unchanged, 1 a number (`stream_value`), `n + 1` a
    /// buffer of `n` elements (`stream_buffer`).
    pub fn take_stream_change(&self, index: u32) -> u32 {
        self.mailbox
            .changed
            .get(index as usize)
            .map_or(0, |changed| changed.replace(0))
    }

    /// Number stream `index`'s latest value.
    pub fn stream_value(&self, index: u32) -> f64 {
        self.mailbox
            .values
            .get(index as usize)
            .map_or(f64::NAN, Cell::get)
    }

    /// Buffer stream `index`'s storage, of its element type.
    pub fn stream_buffer(&self, index: u32) -> *const u8 {
        self.mailbox.buffer(index).0.cast_const()
    }
}

impl<P: Processor> Default for WasmHandle<P> {
    fn default() -> Self {
        Self::new()
    }
}

/// The counts a runtime checks the module against.
pub fn contract() -> [u32; 5] {
    [
        ABI_VERSION,
        Parameters::COUNT as u32,
        PUBLISHED.len() as u32,
        STREAMS.len() as u32,
        STATE_SIZE as u32,
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
            /// # Safety
            /// `pointer` is null or a live, uniquely owned handle returned
            /// by `soundor_wasm_create`, and is never used afterwards.
            pub unsafe extern "C" fn soundor_wasm_destroy(pointer: *mut __Handle) {
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
            pub extern "C" fn soundor_wasm_state(pointer: *mut __Handle) -> *mut u8 {
                handle(pointer).state()
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
            pub extern "C" fn soundor_wasm_resource_input(
                pointer: *mut __Handle,
                length: usize,
            ) -> *mut u8 {
                handle(pointer).resource_input(length)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_resource_publish(
                pointer: *mut __Handle,
                index: u32,
            ) -> i32 {
                let h = handle(pointer);
                h.publish_resource(index)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_reset(pointer: *mut __Handle) -> i32 {
                handle(pointer).reset() as i32
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_midi_input(
                pointer: *mut __Handle,
                offset: u32,
                bytes: u32,
                source: u32,
            ) -> i32 {
                handle(pointer).midi_input(offset, bytes, source)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_midi_data(
                pointer: *mut __Handle,
                publication: u32,
            ) -> *const $crate::midi_ffi::WireMidiEvent {
                handle(pointer).midi_data(publication != 0)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_midi_count(
                pointer: *mut __Handle,
                publication: u32,
            ) -> usize {
                handle(pointer).midi_count(publication != 0)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_midi_generation(pointer: *mut __Handle) -> f64 {
                handle(pointer).midi_generation() as f64
            }
            // The streams' exports keep their first names, `channel`: the
            // engine's WebAssembly host looks them up by name.
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_channel_changed(
                pointer: *mut __Handle,
                index: u32,
            ) -> u32 {
                handle(pointer).take_stream_change(index)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_channel_value(
                pointer: *mut __Handle,
                index: u32,
            ) -> f64 {
                handle(pointer).stream_value(index)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_wasm_channel_buffer(
                pointer: *mut __Handle,
                index: u32,
            ) -> *const u8 {
                handle(pointer).stream_buffer(index)
            }
        }
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __export_wasm_controller {
    ($controller:ty) => {
        #[cfg(target_arch = "wasm32")]
        #[doc(hidden)]
        pub mod __soundor_wasm_controller {
            use super::*;
            type Handle = $crate::wasm_controller::Handle<$controller>;
            fn handle<'a>(pointer: *mut Handle) -> &'a mut Handle {
                // SAFETY: the browser owns this handle until destroy; calls are serialized.
                unsafe { &mut *pointer }
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_descriptor() -> *const u8 {
                $crate::wasm_controller::descriptor().as_ptr()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_descriptor_size() -> usize {
                $crate::wasm_controller::descriptor().len()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_instance_descriptor() -> *const u8 {
                $crate::wasm_controller::instance_descriptor().as_ptr()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_instance_descriptor_size() -> usize {
                $crate::wasm_controller::instance_descriptor().len()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_create() -> *mut Handle {
                Box::into_raw(Box::new(Handle::default()))
            }
            #[unsafe(no_mangle)]
            /// # Safety
            /// `pointer` is null or a live, uniquely owned handle returned
            /// by `soundor_web_controller_create`, and is never used afterwards.
            pub unsafe extern "C" fn soundor_web_controller_destroy(pointer: *mut Handle) {
                if !pointer.is_null() {
                    // SAFETY: the browser relinquishes its unique ownership.
                    drop(unsafe { Box::from_raw(pointer) });
                }
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_input(
                pointer: *mut Handle,
                length: usize,
            ) -> *mut u8 {
                handle(pointer).input(length)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_output(pointer: *mut Handle) -> *const u8 {
                handle(pointer).output()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_output_size(pointer: *mut Handle) -> usize {
                handle(pointer).length()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_call(
                pointer: *mut Handle,
                method: u32,
                operation: u32,
            ) -> i32 {
                handle(pointer).call(method, operation)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_run(pointer: *mut Handle) -> i32 {
                handle(pointer).run()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_operation(pointer: *mut Handle) -> u32 {
                handle(pointer).operation()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_cancel(pointer: *mut Handle, operation: u32) {
                handle(pointer).cancel(operation);
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_midi_enabled() -> bool {
                <$controller as $crate::Controller>::MIDI_INPUT
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_midi_active(
                pointer: *mut Handle,
                active: bool,
            ) {
                handle(pointer).midi_active(active);
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_midi_take(pointer: *mut Handle) {
                handle(pointer).midi_take();
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_midi_receive(
                pointer: *mut Handle,
                reset: bool,
            ) -> bool {
                handle(pointer).midi_receive(reset)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_web_controller_resources(pointer: *mut Handle) {
                handle(pointer).resources();
            }
        }
    };
}
