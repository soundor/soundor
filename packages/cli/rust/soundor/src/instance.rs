//! One processor's lifecycle, the same whichever runtime drives it: the C ABI
//! (`ffi`), WebAssembly, and `testing` all go through [`Instance`]. It
//! checks every block before the processor sees it, gives the processor safe
//! slices, keeps it within the frames it was prepared for, and contains its
//! panics.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use crate::audio::Audio;
use crate::context::{ActiveLayout, PrepareContext, ProcessContext};
use crate::plugin::{
    PUBLISHED, Parameters, Publish, ResourcePublishers, ResourceSlots, Resources, StateSnapshot,
    Streams,
};
use crate::processor::Processor;
use crate::streams::StreamSink;
use crate::transport::Transport;

/// The most buses, channels per bus, and frames per block a runtime may
/// prepare a processor with. Beyond them, `prepare` refuses.
pub(crate) const MAX_BUSES: usize = 64;
pub(crate) const MAX_CHANNELS: usize = 64;
pub(crate) const MAX_FRAMES: usize = 1 << 20;

/// What a lifecycle call did; the C ABI's return value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum Status {
    /// It succeeded.
    Ok = 0,
    /// An argument was invalid (a null or overlapping buffer, a count that
    /// does not match the prepared layout, a non-finite sample rate...). The
    /// processor did not run; outputs it could reach are silent.
    InvalidArgument = 1,
    /// `process` before a successful `prepare`. Outputs are silent.
    NotPrepared = 2,
    /// The processor panicked before; it stays silent until prepared again.
    Failed = 3,
    /// The processor panicked in this call. Outputs are silent.
    Panicked = 4,
    /// The runtime and the processor were built for different ABIs.
    AbiMismatch = 5,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Created,
    Prepared,
    Failed,
}

/// A block as a runtime hands it over: raw channel pointers, one per channel
/// of each bus of the prepared layout, in bus order.
pub(crate) struct Block<'a> {
    pub frames: usize,
    pub inputs: &'a [*const f32],
    pub outputs: &'a [*mut f32],
    /// The parameters' plain values for this block, in the config's order;
    /// `None` keeps the last block's.
    pub parameters: Option<&'a [f64]>,
    pub transport: Transport,
    pub streams: &'a dyn StreamSink,
    /// The state for this block; `None` is the config's defaults.
    pub state: Option<&'a StateSnapshot>,
}

pub(crate) struct Instance<P: Processor> {
    processor: P,
    pub(crate) midi: crate::midi::MidiStorage,
    state: State,
    sample_rate: f64,
    max_frames: usize,
    inputs: Vec<usize>,
    outputs: Vec<usize>,
    // A chunk's channel pointers, sized in `prepare`: process never allocates.
    input_chunk: Vec<*const f32>,
    output_chunk: Vec<*mut f32>,
    parameters: Parameters,
    published: [f64; PUBLISHED.len()],
    // What a block without a state of its own sees.
    default_state: Box<StateSnapshot>,
    // Each resource's handoff, shared with the plugin's controller, which
    // publishes too; dropped with the last of them, outside the audio
    // thread, with whatever it still holds.
    resources: Arc<ResourceSlots>,
}

impl<P: Processor> Instance<P> {
    pub fn new() -> Self {
        Self {
            processor: P::default(),
            midi: crate::midi::MidiStorage::default(),
            state: State::Created,
            sample_rate: 0.0,
            max_frames: 0,
            inputs: Vec::new(),
            outputs: Vec::new(),
            input_chunk: Vec::new(),
            output_chunk: Vec::new(),
            parameters: Parameters::default(),
            published: [f64::NAN; PUBLISHED.len()],
            default_state: StateSnapshot::boxed_defaults(),
            resources: Arc::new(ResourceSlots::default()),
        }
    }

    /// The resources' handoff, for the plugin's controller to publish to.
    pub fn resource_slots(&self) -> Arc<ResourceSlots> {
        self.resources.clone()
    }

    pub fn processor(&self) -> &P {
        &self.processor
    }

    pub fn processor_mut(&mut self) -> &mut P {
        &mut self.processor
    }

    pub fn parameters_mut(&mut self) -> &mut Parameters {
        &mut self.parameters
    }

    pub fn has_failed(&self) -> bool {
        self.state == State::Failed
    }

    pub fn layout(&self) -> (&[usize], &[usize]) {
        (&self.inputs, &self.outputs)
    }

    /// What the last block published for each read-only parameter, by slot
    /// (`NaN` when it published nothing).
    pub fn published(&self) -> &[f64] {
        &self.published
    }

    /// Outside the audio thread. A failed processor is replaced by a new one.
    /// `parameters`, when given, are the current plain values `prepare` sees;
    /// `state` the current state (`None`: the config's defaults).
    pub fn prepare(
        &mut self,
        sample_rate: f64,
        max_frames: usize,
        inputs: &[usize],
        outputs: &[usize],
        parameters: Option<&[f64]>,
        state: Option<&StateSnapshot>,
    ) -> Status {
        if !(sample_rate.is_finite() && sample_rate > 0.0)
            || max_frames == 0
            || max_frames > MAX_FRAMES
            || inputs.len() > MAX_BUSES
            || outputs.len() > MAX_BUSES
            || inputs
                .iter()
                .chain(outputs)
                .any(|&count| count > MAX_CHANNELS)
            || parameters.is_some_and(|values| {
                values.len() != Parameters::COUNT || values.iter().any(|value| !value.is_finite())
            })
        {
            return Status::InvalidArgument;
        }
        if let Some(values) = parameters {
            self.parameters.read(values);
        }
        if self.state == State::Failed {
            let replaced = catch_unwind(AssertUnwindSafe(|| {
                self.processor = P::default();
            }));
            if replaced.is_err() {
                return Status::Panicked;
            }
        }
        self.sample_rate = sample_rate;
        self.max_frames = max_frames;
        self.inputs.clear();
        self.inputs.extend_from_slice(inputs);
        self.outputs.clear();
        self.outputs.extend_from_slice(outputs);
        self.input_chunk = vec![std::ptr::null(); inputs.iter().sum()];
        self.output_chunk = vec![std::ptr::null_mut(); outputs.iter().sum()];
        self.midi.reset();
        let ctx = PrepareContext {
            sample_rate,
            max_frames,
            layout: ActiveLayout {
                inputs: &self.inputs,
                outputs: &self.outputs,
            },
            params: &self.parameters,
            state: state.unwrap_or(&self.default_state),
            resources: ResourcePublishers::new(&self.resources),
        };
        // What the audio thread is done with, freed here.
        self.resources.collect();
        let processor = &mut self.processor;
        match catch_unwind(AssertUnwindSafe(|| processor.prepare(&ctx))) {
            Ok(()) => {
                self.midi
                    .incoming
                    .active
                    .store(true, std::sync::atomic::Ordering::Release);
                self.state = State::Prepared;
                Status::Ok
            }
            Err(_) => {
                self.midi
                    .incoming
                    .active
                    .store(false, std::sync::atomic::Ordering::Release);
                self.state = State::Failed;
                Status::Panicked
            }
        }
    }

    /// Between blocks, on any one thread.
    pub fn reset(&mut self) -> Status {
        self.midi.reset();
        match self.state {
            State::Created => return Status::NotPrepared,
            State::Failed => return Status::Failed,
            State::Prepared => {}
        }
        let processor = &mut self.processor;
        match catch_unwind(AssertUnwindSafe(|| processor.reset())) {
            Ok(()) => Status::Ok,
            Err(_) => {
                self.midi
                    .incoming
                    .active
                    .store(false, std::sync::atomic::Ordering::Release);
                self.state = State::Failed;
                Status::Panicked
            }
        }
    }

    /// On the audio thread: never allocates, unless the processor does.
    pub fn process(&mut self, block: Block<'_>) -> Status {
        self.published.fill(f64::NAN);
        self.midi.receive();
        self.midi.output.clear();
        self.midi.publication.clear();
        if self.midi.recovery {
            let status = self.reset();
            if status != Status::Ok {
                return status;
            }
        }
        if self
            .midi
            .input
            .events()
            .iter()
            .any(|event| !crate::midi::valid_offset(event.sample_offset, block.frames))
        {
            self.midi.input.clear();
            self.midi.recovery = true;
            silence_if_valid(self, &block);
            return Status::InvalidArgument;
        }
        if !self.valid(&block) {
            self.midi.input.clear();
            self.midi.recovery = true;
            return Status::InvalidArgument;
        }
        if self.state != State::Prepared {
            silence(&block);
            return if self.state == State::Failed {
                Status::Failed
            } else {
                Status::NotPrepared
            };
        }
        if let Some(values) = block.parameters {
            if values.len() != Parameters::COUNT || values.iter().any(|value| !value.is_finite()) {
                silence(&block);
                return Status::InvalidArgument;
            }
            self.parameters.read(values);
        }
        // SAFETY: only `process` acquires and reads, one call at a time; the
        // last block's `Resources` are gone.
        unsafe { self.resources.acquire() };
        start_in_place(
            &block,
            self.inputs.first().copied().unwrap_or(0),
            self.outputs.first().copied().unwrap_or(0),
        );

        let mut offset = 0;
        loop {
            let frames = (block.frames - offset).min(self.max_frames);
            for (chunk, &pointer) in self.input_chunk.iter_mut().zip(block.inputs) {
                *chunk = offset_pointer(pointer, offset, block.frames);
            }
            for (chunk, &pointer) in self.output_chunk.iter_mut().zip(block.outputs) {
                *chunk = offset_pointer(pointer, offset, block.frames).cast_mut();
            }
            // SAFETY: `valid` checked every pointer for `block.frames` and
            // the overlaps `Audio::new` rules out; a chunk is a sub-range.
            let audio = unsafe {
                Audio::new(
                    frames,
                    &self.input_chunk,
                    &self.output_chunk,
                    &self.inputs,
                    &self.outputs,
                )
            };
            self.midi.chunk(offset, frames);
            let mut ctx = ProcessContext {
                midi: self.midi.context(frames, offset as u32),
                params: &self.parameters,
                state: block.state.unwrap_or(&self.default_state),
                audio,
                transport: &block.transport,
                publish: Publish {
                    slots: &mut self.published,
                },
                streams: Streams::new(block.streams),
                // SAFETY: acquired at this block's start; `ctx` ends with it.
                resources: unsafe { Resources::new(&self.resources) },
                sample_rate: self.sample_rate,
            };
            let processor = &mut self.processor;
            if catch_unwind(AssertUnwindSafe(|| processor.process(&mut ctx))).is_err() {
                self.midi
                    .incoming
                    .active
                    .store(false, std::sync::atomic::Ordering::Release);
                self.state = State::Failed;
                self.published.fill(f64::NAN);
                self.midi.reset();
                silence(&block);
                return Status::Panicked;
            }
            offset += frames;
            if offset >= block.frames {
                self.midi.deliver();
                self.midi.input.clear();
                let dropped = self
                    .midi
                    .output
                    .dropped
                    .saturating_add(self.midi.publication.dropped);
                if dropped != self.midi.last_dropped {
                    self.midi.recovery = true;
                    self.midi.last_dropped = dropped;
                }
                return Status::Ok;
            }
        }
    }

    /// Whether every pointer of `block` is usable for its frames, the counts
    /// match the prepared layout, and no output overlaps another channel
    /// except its own main input (in place).
    fn valid(&self, block: &Block<'_>) -> bool {
        if block.frames > MAX_FRAMES {
            return false;
        }
        if self.state == State::Prepared
            && (block.inputs.len() != self.input_chunk.len()
                || block.outputs.len() != self.output_chunk.len())
        {
            return false;
        }
        if block.frames == 0 {
            return true;
        }
        let usable =
            |address: usize| address != 0 && address.is_multiple_of(std::mem::align_of::<f32>());
        if !block.inputs.iter().all(|&pointer| usable(pointer as usize))
            || !block
                .outputs
                .iter()
                .all(|&pointer| usable(pointer as usize))
        {
            return false;
        }
        let bytes = block.frames * std::mem::size_of::<f32>();
        let overlap =
            |a: usize, b: usize| a < b.saturating_add(bytes) && b < a.saturating_add(bytes);
        for (index, &output) in block.outputs.iter().enumerate() {
            let output = output as usize;
            if block.outputs[index + 1..]
                .iter()
                .any(|&other| overlap(output, other as usize))
            {
                return false;
            }
        }
        let main_outputs = self.outputs.first().copied().unwrap_or(0);
        for (index, &input) in block.inputs.iter().enumerate() {
            let input = input as usize;
            for (channel, &output) in block.outputs.iter().enumerate() {
                let in_place = index == channel
                    && channel < main_outputs
                    && index < self.inputs.first().copied().unwrap_or(0);
                if overlap(input, output as usize) && !(in_place && input == output as usize) {
                    return false;
                }
            }
        }
        true
    }
}

fn offset_pointer(pointer: *const f32, offset: usize, frames: usize) -> *const f32 {
    if frames == 0 {
        // Never read: a zero-length slice still needs an aligned, non-null
        // pointer, which a runtime may not pass for an empty block.
        return std::ptr::NonNull::<f32>::dangling().as_ptr();
    }
    pointer.wrapping_add(offset)
}

/// The main output starts as the main input (or silence), the other outputs
/// as silence.
fn start_in_place(block: &Block<'_>, main_inputs: usize, main_outputs: usize) {
    if block.frames == 0 {
        return;
    }
    for (channel, &output) in block.outputs.iter().enumerate() {
        let input =
            (channel < main_outputs && channel < main_inputs).then(|| block.inputs[channel]);
        // SAFETY: checked by `valid`: aligned, for `frames`, and an input
        // is either this very output or does not overlap it.
        unsafe {
            match input {
                Some(input) if input == output.cast_const() => {}
                Some(input) => std::ptr::copy_nonoverlapping(input, output, block.frames),
                None => std::ptr::write_bytes(output, 0, block.frames),
            }
        }
    }
}

/// Silences every output of a block that passed `valid`.
fn silence(block: &Block<'_>) {
    if block.frames == 0 {
        return;
    }
    for &output in block.outputs {
        // SAFETY: checked by `valid`.
        unsafe { std::ptr::write_bytes(output, 0, block.frames) };
    }
}

fn silence_if_valid<P: Processor>(instance: &Instance<P>, block: &Block<'_>) {
    if instance.valid(block) {
        silence(block);
    }
}

impl<P: Processor> Drop for Instance<P> {
    fn drop(&mut self) {
        self.midi
            .incoming
            .active
            .store(false, std::sync::atomic::Ordering::Release);
        self.midi.reset();
    }
}
