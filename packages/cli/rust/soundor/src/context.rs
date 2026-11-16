use crate::audio::Audio;
use crate::layout::Layout;
use crate::plugin::{LAYOUTS, Parameters, Publish, StateSnapshot, Streams};
use crate::transport::Transport;

/// The audio layout the host negotiated, among those soundor.config
/// supports: how many channels each bus has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActiveLayout<'a> {
    pub(crate) inputs: &'a [usize],
    pub(crate) outputs: &'a [usize],
}

impl<'a> ActiveLayout<'a> {
    /// Channels of each input bus, in the config's order (0 when disabled).
    pub fn inputs(&self) -> &'a [usize] {
        self.inputs
    }

    /// Channels of each output bus, in the config's order.
    pub fn outputs(&self) -> &'a [usize] {
        self.outputs
    }

    /// Channels of the main input bus.
    pub fn main_input_channels(&self) -> usize {
        self.inputs.first().copied().unwrap_or(0)
    }

    /// Channels of the main output bus.
    pub fn main_output_channels(&self) -> usize {
        self.outputs.first().copied().unwrap_or(0)
    }

    /// The config's layout (`audio.layouts`) this one is, by name: the first
    /// that accepts it. `None` when the config declares no `audio`.
    pub fn name(&self) -> Option<&'static str> {
        self.config().map(|layout| layout.name)
    }

    /// The config's layout this one is, the first that accepts it.
    pub fn config(&self) -> Option<&'static Layout> {
        LAYOUTS
            .iter()
            .find(|layout| layout.accepts(self.inputs, self.outputs))
    }
}

/// What [`prepare`](crate::AudioProcessor::prepare) is given.
#[non_exhaustive]
pub struct PrepareContext<'a> {
    /// The sample rate, in hertz.
    pub sample_rate: f64,
    /// The most frames a block will hold until the next `prepare`.
    pub max_frames: usize,
    /// The bus arrangement every block will have until the next `prepare`.
    pub layout: ActiveLayout<'a>,
    /// The parameters' current values.
    pub params: &'a Parameters,
    /// The persistent state the processing reads (`audio: true`), as it is
    /// now.
    pub state: &'a StateSnapshot,
}

/// What [`process`](crate::AudioProcessor::process) is given for one block.
///
/// Its fields are borrowed apart, so a processor can read `ctx.params` while
/// it writes `ctx.audio`.
#[non_exhaustive]
pub struct ProcessContext<'a> {
    /// The parameters' values for this block, typed as soundor.config
    /// declares them. Automation reaches the processing once a block.
    pub params: &'a Parameters,
    /// The persistent state the processing reads (`audio: true`), typed as
    /// soundor.config declares it. The block sees one snapshot from start to
    /// end, every field as of the same state change: a change reaches the
    /// processing at the next block, and changes in between are coalesced.
    pub state: &'a StateSnapshot,
    /// The block's audio.
    pub audio: Audio<'a>,
    /// The host's transport at the start of the block.
    pub transport: &'a Transport,
    /// Sets the config's read-only parameters (meters) the processing owns.
    pub publish: Publish<'a>,
    /// The config's native streams, to publish to editors.
    pub streams: Streams<'a>,
    /// The sample rate, in hertz, as prepared.
    pub sample_rate: f64,
}
