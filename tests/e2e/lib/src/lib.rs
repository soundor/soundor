//! The E2E plugin's Rust: a processor whose output a test can predict
//! exactly, and a controller with one of each kind of native method.

use soundor::choices::Mode;
use soundor::prelude::*;

/// How many samples of each block the `scope` stream carries.
pub const SCOPE: usize = 64;

/// output = input × gain × level, inverted in `invert` mode, untouched when
/// bypassed. Publishes the block's peak (`peak`) and its first samples of
/// the left channel (`scope`). Memoryless, so any block size plays the same.
#[derive(Default)]
pub struct PluginProcessor;

impl Processor for PluginProcessor {
    fn prepare(&mut self, _ctx: &PrepareContext) {}

    fn process(&mut self, ctx: &mut ProcessContext) {
        let mut factor = ctx.params.gain * ctx.state.level;
        if ctx.params.mode == Mode::Invert {
            factor = -factor;
        }
        let bypass = ctx.params.bypass;
        let mut peak = 0.0f32;
        for channel in ctx.audio.channels() {
            for sample in channel {
                if !bypass {
                    *sample *= factor;
                }
                peak = peak.max(sample.abs());
            }
        }
        ctx.streams.peak.publish(peak);
        let mut written = 0;
        if let Some(left) = ctx.audio.channels().next() {
            let scope = ctx.streams.scope.buffer_mut();
            written = left.len().min(SCOPE).min(scope.len());
            scope[..written].copy_from_slice(&left[..written]);
        }
        ctx.streams.scope.commit(written);
    }
}

/// What the controller keeps between calls: how often countLater ran.
#[derive(Default)]
pub struct LocalStore {
    count: i32,
}

pub struct PluginController;

impl Controller for PluginController {
    type Local = LocalStore;
    type Shared = ();
}

impl NativeMethods for PluginController {
    /// The text backwards, by characters: strings cross both ways intact.
    fn reverse(_ctx: &mut TaskContext<Self>, text: String) -> String {
        text.chars().rev().collect()
    }

    /// Counts on the control thread, from an async task, and tells the UI
    /// with the `counted` event before the promise settles.
    async fn count_later(ctx: AsyncTaskContext<Self>) -> Result<i32, Error> {
        let count = ctx
            .schedule(|ctx| {
                ctx.store.local.count += 1;
                let count = ctx.store.local.count;
                ctx.events.counted(events::CountedEvent { count });
                count
            })
            .await?;
        Ok(count)
    }
}

soundor::export!(PluginProcessor, PluginController);
