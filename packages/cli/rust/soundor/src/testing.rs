//! Tests of a processor in plain Rust, through the same lifecycle the
//! runtimes drive: no host, no JUCE, no browser.
//!
//! ```ignore
//! use soundor::testing::TestProcessor;
//!
//! #[test]
//! fn halves_the_signal() {
//!     let mut processor = TestProcessor::<Processor>::new()
//!         .sample_rate(48_000.0)
//!         .block_size(256)
//!         .parameter("gain", 0.5)
//!         .build();
//!     let output = processor.process(&[vec![1.0, 0.5, -1.0]]);
//!     assert_eq!(output[0], [0.5, 0.25, -0.5]);
//! }
//! ```
//!
//! [`TestProcessor`] runs the processor itself; [`NativeProcessor`] runs it
//! through the C ABI that `soundor::export!` defines, as a native runtime
//! does.
//!
//! # Real-time safety
//!
//! A processor runs on the audio thread, where taking the allocator's lock
//! can make it miss its deadline. With [`CountingAllocator`] as the test
//! binary's global allocator, both count the allocator calls the processor
//! makes while it processes:
//!
//! ```ignore
//! #[global_allocator]
//! static ALLOCATOR: soundor::testing::CountingAllocator = soundor::testing::CountingAllocator;
//!
//! #[test]
//! fn processing_does_not_allocate() {
//!     let mut processor = TestProcessor::<Processor>::new().build();
//!     processor.process(&[vec![0.5; 4096]]);
//!     assert_eq!(processor.allocations(), 0);
//! }
//! ```

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};

pub use crate::controller_testing::{TestController, TestHost};
use crate::ffi::{
    Exports, SoundorBlock, SoundorPrepare, SoundorProcessorInfo, SoundorStreamSink,
    SoundorTransport,
};
pub use crate::host::HistoryAction;
pub use crate::instance::Status;
use crate::instance::{Block, Instance};
use crate::plugin::{
    DEFAULT_INPUTS, DEFAULT_OUTPUTS, PUBLISHED, Parameters, STATE_SIZE, STREAMS, StateSnapshot,
};
use crate::processor::Processor;
use crate::streams::StreamSink;
use crate::transport::Transport;
use crate::{ABI_VERSION, config};

/// The system allocator, counting the calls made on a thread while it runs
/// [`count_allocations`]: allocations, reallocations and frees alike, each
/// of which may take a lock. Install it as the test binary's
/// `#[global_allocator]`.
pub struct CountingAllocator;

static INSTALLED: AtomicBool = AtomicBool::new(false);

thread_local! {
    // Const-initialized: reading them never allocates.
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static CALLS: Cell<usize> = const { Cell::new(0) };
}

impl CountingAllocator {
    fn record() {
        INSTALLED.store(true, Ordering::Relaxed);
        // During the thread's teardown there is nothing to count.
        let _ = COUNTING.try_with(|counting| {
            if counting.get() {
                let _ = CALLS.try_with(|calls| calls.set(calls.get() + 1));
            }
        });
    }
}

// SAFETY: every call is System's, with the arguments it was given.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        Self::record();
        // SAFETY: as the caller promises.
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        Self::record();
        // SAFETY: as the caller promises.
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        Self::record();
        // SAFETY: as the caller promises.
        unsafe { System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        Self::record();
        // SAFETY: as the caller promises.
        unsafe { System.realloc(pointer, layout, size) }
    }
}

/// Runs `run`, and returns what it returned with the allocator calls it
/// made on this thread.
///
/// # Panics
///
/// When [`CountingAllocator`] is not the global allocator.
pub fn count_allocations<R>(run: impl FnOnce() -> R) -> (R, usize) {
    // Anything allocated before a test runs, if the allocator counts.
    drop(Box::new(0u8));
    assert!(
        INSTALLED.load(Ordering::Relaxed),
        "counting allocations needs soundor::testing::CountingAllocator as the #[global_allocator]: \
         `#[global_allocator] static ALLOCATOR: soundor::testing::CountingAllocator = soundor::testing::CountingAllocator;`"
    );
    let before = CALLS.with(Cell::get);
    COUNTING.with(|counting| counting.set(true));
    let result = run();
    COUNTING.with(|counting| counting.set(false));
    (result, CALLS.with(Cell::get) - before)
}

/// The plain value of `value` for parameter `id`, or why it has none.
fn plain(id: &str, value: f64) -> Result<usize, String> {
    let Some(index) = config::PARAMETER_IDS.iter().position(|known| *known == id) else {
        return Err(format!(
            "soundor.config declares no parameter '{id}' (it declares {})",
            config::PARAMETER_IDS.join(", ")
        ));
    };
    let (min, max, integer) = Parameters::RANGES[index];
    if !value.is_finite() || value < min || value > max || (integer && value.fract() != 0.0) {
        return Err(format!(
            "{value} is not a value of parameter '{id}' ({min} to {max}{})",
            if integer { ", whole" } else { "" }
        ));
    }
    Ok(index)
}

/// Sets parameter `id` in `parameters` from its plain value: a number, 0 or
/// 1 for a boolean, the option's index for a choice.
pub fn set_parameter(parameters: &mut Parameters, id: &str, value: f64) -> Result<(), String> {
    let index = plain(id, value)?;
    let mut values = [0.0; Parameters::COUNT];
    parameters.write(&mut values);
    values[index] = value;
    parameters.read(&values);
    Ok(())
}

/// Parameter `id`'s plain value in `parameters`.
pub fn parameter(parameters: &Parameters, id: &str) -> Option<f64> {
    let index = config::PARAMETER_IDS
        .iter()
        .position(|known| *known == id)?;
    let mut values = [0.0; Parameters::COUNT];
    parameters.write(&mut values);
    Some(values[index])
}

/// Records what a processor publishes to the config's native streams.
#[derive(Default)]
struct RecordedStreams {
    values: RefCell<Vec<Option<f64>>>,
    // Each buffer stream's storage: `u64`s, so that it is aligned for, and
    // holds, `maxLength` elements of any type a stream carries.
    storage: RefCell<Vec<Vec<u64>>>,
    // What was committed, copied into storage of the same size: committing
    // allocates nothing, as a runtime's stream does not.
    buffers: RefCell<Vec<Vec<u64>>>,
    committed: RefCell<Vec<bool>>,
    lengths: RefCell<Vec<usize>>,
}

impl RecordedStreams {
    fn new() -> Self {
        let storage = || {
            STREAMS
                .iter()
                .map(|(_, length)| vec![0; length.unwrap_or(0)])
                .collect()
        };
        Self {
            values: RefCell::new(vec![None; STREAMS.len()]),
            storage: RefCell::new(storage()),
            buffers: RefCell::new(storage()),
            committed: RefCell::new(vec![false; STREAMS.len()]),
            lengths: RefCell::new(vec![0; STREAMS.len()]),
        }
    }
}

impl StreamSink for RecordedStreams {
    fn publish(&self, index: u32, value: f64) {
        if let Some(slot) = self.values.borrow_mut().get_mut(index as usize) {
            *slot = Some(value);
        }
    }

    fn buffer(&self, index: u32) -> (*mut u8, usize) {
        let mut storage = self.storage.borrow_mut();
        match storage.get_mut(index as usize) {
            // u64 storage is aligned for every element type.
            Some(buffer) => (buffer.as_mut_ptr().cast(), buffer.len()),
            None => (std::ptr::null_mut(), 0),
        }
    }

    fn commit(&self, index: u32, length: usize) {
        let storage = self.storage.borrow();
        if let Some(buffer) = storage.get(index as usize) {
            let length = length.min(buffer.len());
            self.buffers.borrow_mut()[index as usize].copy_from_slice(buffer);
            self.committed.borrow_mut()[index as usize] = true;
            self.lengths.borrow_mut()[index as usize] = length;
        }
    }
}

/// Builds a [`TestProcessor`]: the sample rate, block size, layout and
/// parameter values it is prepared with.
pub struct TestProcessorBuilder<P: Processor> {
    processor: Option<P>,
    sample_rate: f64,
    block_size: usize,
    inputs: Vec<usize>,
    outputs: Vec<usize>,
    parameters: Parameters,
}

impl<P: Processor> TestProcessorBuilder<P> {
    /// The sample rate, 48 kHz by default.
    pub fn sample_rate(mut self, sample_rate: f64) -> Self {
        self.sample_rate = sample_rate;
        self
    }

    /// The most frames a block holds, and how [`TestProcessor::process`]
    /// splits its input into blocks: 512 by default.
    pub fn block_size(mut self, frames: usize) -> Self {
        self.block_size = frames;
        self
    }

    /// The main buses' channels, the same for input and output; the other
    /// buses keep the config's default layout.
    pub fn channels(mut self, channels: usize) -> Self {
        if let Some(main) = self.inputs.first_mut() {
            *main = channels;
        }
        if let Some(main) = self.outputs.first_mut() {
            *main = channels;
        }
        self
    }

    /// The channels of every input bus and every output bus, in the config's
    /// order. By default, the config's default layout (stereo in and out
    /// without an `audio` declaration).
    pub fn layout(mut self, inputs: &[usize], outputs: &[usize]) -> Self {
        self.inputs = inputs.to_vec();
        self.outputs = outputs.to_vec();
        self
    }

    /// The config's layout `name` (`audio.layouts`), each bus with its
    /// first channel arrangement.
    ///
    /// # Panics
    ///
    /// When the config declares no layout so named.
    pub fn named_layout(self, name: &str) -> Self {
        let layout = config::LAYOUTS
            .iter()
            .find(|layout| layout.name == name)
            .unwrap_or_else(|| panic!("soundor.config declares no audio layout '{name}'"));
        let first = |buses: &[&[usize]]| buses.iter().map(|choices| choices[0]).collect::<Vec<_>>();
        let (inputs, outputs) = (first(layout.inputs), first(layout.outputs));
        self.layout(&inputs, &outputs)
    }

    /// Parameter `id`'s plain value: a number, 0 or 1 for a boolean, the
    /// option's index for a choice.
    ///
    /// # Panics
    ///
    /// When the config declares no such parameter, or `value` is not one of
    /// its values.
    pub fn parameter(mut self, id: &str, value: f64) -> Self {
        if let Err(message) = set_parameter(&mut self.parameters, id, value) {
            panic!("{message}");
        }
        self
    }

    /// Changes the parameters, typed: `.parameters(|p| p.gain = 0.5)`.
    pub fn parameters(mut self, change: impl FnOnce(&mut Parameters)) -> Self {
        change(&mut self.parameters);
        self
    }

    /// The processor to test, instead of its `Default`.
    pub fn processor(mut self, processor: P) -> Self {
        self.processor = Some(processor);
        self
    }

    /// Constructs and prepares the processor.
    ///
    /// # Panics
    ///
    /// When `prepare` fails.
    pub fn build(self) -> TestProcessor<P> {
        let mut instance = Instance::<P>::new();
        if let Some(processor) = self.processor {
            *instance.processor_mut() = processor;
        }
        *instance.parameters_mut() = self.parameters;
        let mut processor = TestProcessor {
            instance,
            sample_rate: self.sample_rate,
            block_size: self.block_size,
            parameters: self.parameters,
            transport: Transport::default(),
            streams: RecordedStreams::new(),
            state: StateSnapshot::boxed_defaults(),
            allocations: 0,
        };
        let status = processor.prepare_with(
            self.sample_rate,
            self.block_size,
            &self.inputs,
            &self.outputs,
        );
        assert_eq!(status, Status::Ok, "the processor could not be prepared");
        processor
    }
}

/// A prepared processor, run as a runtime runs it, with buffers of plain
/// `f32`s.
pub struct TestProcessor<P: Processor> {
    instance: Instance<P>,
    sample_rate: f64,
    block_size: usize,
    parameters: Parameters,
    transport: Transport,
    streams: RecordedStreams,
    state: Box<StateSnapshot>,
    allocations: usize,
}

impl<P: Processor> TestProcessor<P> {
    /// Its resources' handoff, which a controller of the same plugin
    /// instance publishes to (`TestController::for_processor`).
    pub(crate) fn resource_slots(&self) -> std::sync::Arc<crate::plugin::ResourceSlots> {
        self.instance.resource_slots()
    }

    /// Starts building one, at 48 kHz, in blocks of 512, in the config's
    /// default layout, with the config's default parameter values.
    #[allow(clippy::new_ret_no_self)]
    pub fn new() -> TestProcessorBuilder<P> {
        TestProcessorBuilder {
            processor: None,
            sample_rate: 48_000.0,
            block_size: 512,
            inputs: DEFAULT_INPUTS.to_vec(),
            outputs: DEFAULT_OUTPUTS.to_vec(),
            parameters: Parameters::default(),
        }
    }

    /// The processor.
    pub fn processor(&self) -> &P {
        self.instance.processor()
    }

    /// The processor, to change.
    pub fn processor_mut(&mut self) -> &mut P {
        self.instance.processor_mut()
    }

    /// The parameters the next block gets.
    pub fn parameters(&self) -> &Parameters {
        &self.parameters
    }

    /// The parameters the next block gets, to change.
    pub fn parameters_mut(&mut self) -> &mut Parameters {
        &mut self.parameters
    }

    /// Sets parameter `id`'s plain value for the next block.
    ///
    /// # Panics
    ///
    /// As [`TestProcessorBuilder::parameter`].
    pub fn set_parameter(&mut self, id: &str, value: f64) {
        if let Err(message) = set_parameter(&mut self.parameters, id, value) {
            panic!("{message}");
        }
    }

    /// The transport the next block gets.
    pub fn transport_mut(&mut self) -> &mut Transport {
        &mut self.transport
    }

    /// The sample rate it was prepared with.
    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    /// Prepares the processor again, at another sample rate or block size
    /// (the layout stays).
    pub fn prepare(&mut self, sample_rate: f64, block_size: usize) -> Status {
        let (inputs, outputs) = self.instance.layout();
        let (inputs, outputs) = (inputs.to_vec(), outputs.to_vec());
        self.prepare_with(sample_rate, block_size, &inputs, &outputs)
    }

    /// Prepares the processor again in another layout.
    pub fn prepare_with(
        &mut self,
        sample_rate: f64,
        block_size: usize,
        inputs: &[usize],
        outputs: &[usize],
    ) -> Status {
        self.sample_rate = sample_rate;
        self.block_size = block_size;
        let mut values = [0.0; Parameters::COUNT];
        self.parameters.write(&mut values);
        self.instance.prepare(
            sample_rate,
            block_size,
            inputs,
            outputs,
            Some(&values),
            Some(&self.state),
        )
    }

    /// Internal sender, independent of host MIDI capabilities.
    pub fn midi_sender(&self, source: crate::MidiSource) -> crate::midi::MidiSender {
        self.instance.midi.sender(source)
    }

    /// Injects a host event for the next block, retaining its sample offset.
    /// Full input storage requests reset before the next block.
    pub fn midi_input(&mut self, event: crate::MidiEvent) -> Result<(), crate::MidiError> {
        let result = self.instance.midi.input.push(event);
        if result == Err(crate::MidiError::Full) {
            self.instance.midi.recovery = true;
        }
        result
    }

    /// Explicit host output of the most recent block, even with host MIDI disabled.
    pub fn midi_output(&self) -> &[crate::MidiEvent] {
        self.instance.midi.output.events()
    }

    /// Explicit observer publications of the most recent block.
    pub fn midi_publications(&self) -> &[crate::MidiEvent] {
        self.instance.midi.publication.events()
    }

    /// Resets the processor, as a host does between playbacks.
    pub fn reset(&mut self) -> Status {
        self.instance.reset()
    }

    /// Whether a panic made the processor fail (until prepared again).
    pub fn has_failed(&self) -> bool {
        self.instance.has_failed()
    }

    /// Processes `input`, the main input's channels, in blocks of the block
    /// size, and returns the main output's channels. Missing input channels
    /// are silent; every channel is as long as the longest given.
    ///
    /// # Panics
    ///
    /// When a block fails (see [`try_process_buses`](Self::try_process_buses)).
    pub fn process<C: AsRef<[f32]>>(&mut self, input: &[C]) -> Vec<Vec<f32>> {
        let input: Vec<&[f32]> = input.iter().map(AsRef::as_ref).collect();
        let mut outputs = self.process_buses(&[&input]);
        if outputs.is_empty() {
            Vec::new()
        } else {
            outputs.swap_remove(0)
        }
    }

    /// Processes every bus: `inputs[bus][channel]`, in blocks of the block
    /// size. Returns `outputs[bus][channel]`.
    ///
    /// # Panics
    ///
    /// When a block fails.
    pub fn process_buses(&mut self, inputs: &[&[&[f32]]]) -> Vec<Vec<Vec<f32>>> {
        match self.try_process_buses(inputs) {
            Ok(outputs) => outputs,
            Err(status) => panic!("the processor failed to process: {status:?}"),
        }
    }

    /// [`process_buses`](Self::process_buses), returning the first block's
    /// failure instead of panicking.
    pub fn try_process_buses(
        &mut self,
        inputs: &[&[&[f32]]],
    ) -> Result<Vec<Vec<Vec<f32>>>, Status> {
        let (input_layout, output_layout) = self.instance.layout();
        let (input_layout, output_layout) = (input_layout.to_vec(), output_layout.to_vec());
        let frames = inputs
            .iter()
            .flat_map(|bus| bus.iter())
            .map(|channel| channel.len())
            .max()
            .unwrap_or(0);
        let mut input_buffers: Vec<Vec<f32>> = input_layout
            .iter()
            .enumerate()
            .flat_map(|(bus, &channels)| (0..channels).map(move |channel| (bus, channel)))
            .map(|(bus, channel)| {
                let mut samples = vec![0.0; frames];
                if let Some(given) = inputs.get(bus).and_then(|bus| bus.get(channel)) {
                    samples[..given.len()].copy_from_slice(given);
                }
                samples
            })
            .collect();
        let mut output_buffers: Vec<Vec<f32>> = vec![vec![0.0; frames]; output_layout.iter().sum()];
        let mut offset = 0;
        loop {
            let length = (frames - offset).min(self.block_size.max(1));
            let status = self.run_block(&mut input_buffers, &mut output_buffers, offset, length);
            if status != Status::Ok {
                return Err(status);
            }
            offset += length;
            if offset >= frames {
                break;
            }
        }
        let mut outputs = Vec::new();
        let mut channels = output_buffers.into_iter();
        for &count in &output_layout {
            outputs.push(channels.by_ref().take(count).collect());
        }
        Ok(outputs)
    }

    /// Runs one block of `length` frames at `offset`, as a runtime processing
    /// in place: main input channels are copied into the main outputs, which
    /// the processor is given as the inputs too.
    fn run_block(
        &mut self,
        inputs: &mut [Vec<f32>],
        outputs: &mut [Vec<f32>],
        offset: usize,
        length: usize,
    ) -> Status {
        let (input_layout, output_layout) = self.instance.layout();
        let main_inputs = input_layout.first().copied().unwrap_or(0);
        let main_outputs = output_layout.first().copied().unwrap_or(0);
        let in_place = main_inputs.min(main_outputs);
        for channel in 0..in_place {
            outputs[channel][offset..offset + length]
                .copy_from_slice(&inputs[channel][offset..offset + length]);
        }
        let output_pointers: Vec<*mut f32> = outputs
            .iter_mut()
            .map(|channel| channel[offset..].as_mut_ptr())
            .collect();
        let input_pointers: Vec<*const f32> = inputs
            .iter()
            .enumerate()
            .map(|(channel, samples)| {
                if channel < in_place {
                    output_pointers[channel].cast_const()
                } else {
                    samples[offset..].as_ptr()
                }
            })
            .collect();
        let mut values = [0.0; Parameters::COUNT];
        self.parameters.write(&mut values);
        let block = Block {
            frames: length,
            inputs: &input_pointers,
            outputs: &output_pointers,
            parameters: Some(&values),
            transport: self.transport,
            streams: &self.streams,
            state: Some(&self.state),
        };
        let (status, allocations) = counted(|| self.instance.process(block));
        self.allocations += allocations;
        // What it published, as a host would see it next.
        for (slot, &index) in PUBLISHED.iter().enumerate() {
            let value = self.instance.published()[slot];
            if !value.is_nan() {
                let id = config::PARAMETER_IDS[index];
                let _ = set_parameter(
                    &mut self.parameters,
                    id,
                    value.clamp(Parameters::RANGES[index].0, Parameters::RANGES[index].1),
                );
            }
        }
        status
    }

    /// Processes one block of `frames` frames, without samples of its own:
    /// the main outputs start silent. Returns its status, for lifecycle tests.
    pub fn process_silence(&mut self, frames: usize) -> Status {
        let (inputs, outputs) = self.instance.layout();
        let (inputs, outputs) = (inputs.iter().sum::<usize>(), outputs.iter().sum::<usize>());
        let mut input_buffers = vec![vec![0.0; frames]; inputs];
        let mut output_buffers = vec![vec![0.0; frames]; outputs];
        self.run_block(&mut input_buffers, &mut output_buffers, 0, frames)
    }

    /// The allocator calls the processor made while it processed, every block
    /// so far.
    ///
    /// # Panics
    ///
    /// When [`CountingAllocator`] is not the test binary's global allocator.
    pub fn allocations(&self) -> usize {
        count_allocations(|| ());
        self.allocations
    }

    /// The state the processor reads (`ctx.state`), as the plugin's state
    /// would set it: the config's defaults to start with. Changes reach the
    /// next block.
    pub fn state_mut(&mut self) -> &mut StateSnapshot {
        &mut self.state
    }

    /// The state the processor reads.
    pub fn state(&self) -> &StateSnapshot {
        &self.state
    }

    /// The latest value published to stream `name`, a number stream.
    pub fn stream(&self, name: &str) -> Option<f64> {
        let index = STREAMS.iter().position(|(id, _)| *id == name)?;
        self.streams.values.borrow()[index]
    }

    /// The latest buffer committed to stream `name`, read as `T` (its
    /// declared element type).
    pub fn stream_buffer<T: crate::StreamElement>(&self, name: &str) -> Option<Vec<T>> {
        let index = STREAMS.iter().position(|(id, _)| *id == name)?;
        if !self.streams.committed.borrow()[index] {
            return None;
        }
        let buffers = self.streams.buffers.borrow();
        let buffer = &buffers[index];
        let length = self.streams.lengths.borrow()[index];
        // SAFETY: the storage holds at least `length` elements of the
        // stream's type (8 bytes per element reserved), and is aligned.
        let elements = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<T>(), length) };
        Some(elements.to_vec())
    }
}

/// A processor driven through the C ABI that `soundor::export!` defines, as
/// a native runtime does: the very exported functions, with the structures
/// a runtime passes.
///
/// ```ignore
/// let mut native = NativeProcessor::new(crate::__soundor_exports::exports());
/// ```
pub struct NativeProcessor {
    exports: Exports,
    handle: *mut c_void,
    inputs: Vec<u32>,
    outputs: Vec<u32>,
    /// The values passed with each block.
    pub parameters: Vec<f64>,
    /// The read-only parameters' values the last block published.
    pub published: Vec<f64>,
    /// The transport passed with each block.
    pub transport: SoundorTransport,
    /// The state passed to `prepare` and with each block.
    pub state: Box<StateSnapshot>,
    allocations: usize,
}

impl NativeProcessor {
    /// Creates a processor through `exports`, after checking what it was
    /// built from.
    ///
    /// # Panics
    ///
    /// When it reports another ABI or contract, or creation fails.
    pub fn new(exports: Exports) -> Self {
        let mut info = SoundorProcessorInfo::default();
        // SAFETY: a valid, writable structure.
        assert_eq!(unsafe { (exports.info)(&mut info) }, 0);
        assert_eq!(info.abi_version, ABI_VERSION);
        assert_eq!(info.parameter_count as usize, Parameters::COUNT);
        assert_eq!(info.state_size as usize, STATE_SIZE);
        // SAFETY: no arguments.
        let handle = unsafe { (exports.create)() };
        assert!(!handle.is_null(), "creating the processor failed");
        let mut parameters = vec![0.0; Parameters::COUNT];
        Parameters::default().write(&mut parameters);
        Self {
            exports,
            handle,
            inputs: Vec::new(),
            outputs: Vec::new(),
            parameters,
            published: vec![f64::NAN; info.published_count as usize],
            transport: SoundorTransport {
                tempo: f64::NAN,
                time_seconds: f64::NAN,
                position_beats: f64::NAN,
                flags: 0,
                time_signature_numerator: 0,
                time_signature_denominator: 0,
            },
            state: StateSnapshot::boxed_defaults(),
            allocations: 0,
        }
    }

    /// The allocator calls made in `soundor_processor_process`, every block
    /// so far.
    ///
    /// # Panics
    ///
    /// When [`CountingAllocator`] is not the test binary's global allocator.
    pub fn allocations(&self) -> usize {
        count_allocations(|| ());
        self.allocations
    }

    /// The raw handle, for tests of invalid calls.
    pub fn handle(&self) -> *mut c_void {
        self.handle
    }

    /// `soundor_processor_prepare`.
    pub fn prepare(
        &mut self,
        sample_rate: f64,
        max_frames: u32,
        inputs: &[u32],
        outputs: &[u32],
    ) -> i32 {
        self.inputs = inputs.to_vec();
        self.outputs = outputs.to_vec();
        let config = SoundorPrepare {
            size: std::mem::size_of::<SoundorPrepare>() as u32,
            abi_version: ABI_VERSION,
            sample_rate,
            max_frames,
            input_bus_count: inputs.len() as u32,
            input_channels: inputs.as_ptr(),
            output_bus_count: outputs.len() as u32,
            output_channels: outputs.as_ptr(),
            parameter_count: self.parameters.len() as u32,
            parameters: self.parameters.as_ptr(),
            state_size: STATE_SIZE as u32,
            state: std::ptr::from_ref::<StateSnapshot>(&self.state).cast(),
        };
        // SAFETY: a handle from `create`, and a valid configuration.
        unsafe { (self.exports.prepare)(self.handle, &config) }
    }

    /// `soundor_processor_process` over `channels` (every input and output
    /// channel, in place: main input channel `c` is main output channel `c`),
    /// with the extra input channels in `side_inputs`.
    pub fn process_in_place(&mut self, channels: &mut [Vec<f32>], side_inputs: &[Vec<f32>]) -> i32 {
        let frames = channels.first().map_or(0, Vec::len) as u32;
        let main_inputs = self.inputs.first().copied().unwrap_or(0) as usize;
        let outputs: Vec<*mut f32> = channels
            .iter_mut()
            .map(|channel| channel.as_mut_ptr())
            .collect();
        let mut inputs: Vec<*const f32> = outputs
            .iter()
            .take(main_inputs)
            .map(|pointer| pointer.cast_const())
            .collect();
        inputs.extend(side_inputs.iter().map(|channel| channel.as_ptr()));
        self.process_raw(frames, &inputs, &outputs, None)
    }

    /// `soundor_processor_process` with the given pointers, and streams.
    pub fn process_raw(
        &mut self,
        frames: u32,
        inputs: &[*const f32],
        outputs: &[*mut f32],
        streams: Option<&SoundorStreamSink>,
    ) -> i32 {
        let block = SoundorBlock {
            size: std::mem::size_of::<SoundorBlock>() as u32,
            abi_version: ABI_VERSION,
            frames,
            input_count: inputs.len() as u32,
            inputs: inputs.as_ptr(),
            output_count: outputs.len() as u32,
            outputs: outputs.as_ptr(),
            parameter_count: self.parameters.len() as u32,
            parameters: self.parameters.as_ptr(),
            published_count: self.published.len() as u32,
            published: self.published.as_mut_ptr(),
            transport: &self.transport,
            streams: streams.map_or(std::ptr::null(), |sink| sink as *const SoundorStreamSink),
            state_size: STATE_SIZE as u32,
            state: std::ptr::from_ref::<StateSnapshot>(&self.state).cast(),
        };
        let (process, handle) = (self.exports.process, self.handle);
        // SAFETY: a handle from `create`, and a block whose arrays live for
        // the call.
        let (status, allocations) = counted(|| unsafe { process(handle, &block) });
        self.allocations += allocations;
        status
    }

    /// `soundor_processor_process` with a block as given, for tests of
    /// malformed blocks.
    ///
    /// # Safety
    ///
    /// Whatever `block` points to is valid as the ABI requires, except where
    /// the test means it not to be in ways the processor checks.
    pub unsafe fn process_block(&mut self, block: &SoundorBlock) -> i32 {
        // SAFETY: as the caller promises.
        unsafe { (self.exports.process)(self.handle, block) }
    }

    /// `soundor_processor_reset`.
    pub fn reset(&mut self) -> i32 {
        // SAFETY: a handle from `create`.
        unsafe { (self.exports.reset)(self.handle) }
    }
}

impl Drop for NativeProcessor {
    fn drop(&mut self) {
        // SAFETY: a handle from `create`, never used again.
        unsafe { (self.exports.destroy)(self.handle) };
    }
}

/// [`count_allocations`] where [`CountingAllocator`] is installed; `run`
/// alone, and nothing counted, where it is not.
fn counted<R>(run: impl FnOnce() -> R) -> (R, usize) {
    if INSTALLED.load(Ordering::Relaxed) {
        count_allocations(run)
    } else {
        (run(), 0)
    }
}
