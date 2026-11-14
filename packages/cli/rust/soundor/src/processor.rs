use crate::context::{PrepareContext, ProcessContext};

/// A plugin's audio processing.
///
/// A runtime owns one instance per plugin instance and drives it through one
/// lifecycle, the same in every runtime and in [`crate::testing`]:
///
/// 1. it is constructed with [`Default`], outside the audio thread;
/// 2. [`prepare`](Self::prepare) runs whenever the sample rate, the most frames
///    a block holds, or the active layout change, outside the audio thread,
///    before any [`process`](Self::process) with them;
/// 3. [`process`](Self::process) runs for every block, on the audio thread;
/// 4. [`reset`](Self::reset) clears the processing's history (a host stopped
///    and restarted playback, or jumped), between blocks;
/// 5. it is dropped outside the audio thread.
///
/// The runtime never calls two of these at once. `prepare` may allocate;
/// `process` and `reset` run under the audio thread's deadline and must not
/// allocate, block, wait on a lock, or do I/O. Rust does not make that so:
/// keep what `process` needs in the processor, sized in `prepare`.
///
/// A panic is caught at the runtime's boundary: the processor is then
/// considered failed, and its outputs are silent until it is prepared again.
pub trait AudioProcessor: Default + Send + 'static {
    /// Sizes the processor's resources for the sample rate, the most frames a
    /// block will hold, and the active layout.
    fn prepare(&mut self, ctx: &PrepareContext<'_>);

    /// Processes one block: reads `ctx.audio`'s inputs and the parameters'
    /// values for this block, and writes its outputs.
    fn process(&mut self, ctx: &mut ProcessContext<'_>);

    /// Forgets the processing's history (delay lines, filter states,
    /// envelopes), keeping what `prepare` sized. Does nothing by default.
    fn reset(&mut self) {}
}
