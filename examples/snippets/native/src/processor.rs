//! The plugin's audio processing: a gain that follows the `gain` parameter,
//! passed by while `bypass` is on. The snippets are about the UI; the Web
//! host runs this compiled to WebAssembly.

use soundor::prelude::*;

/// Applies `gain`, or unity while bypassed, ramping from one block's value to
/// the next so that a change doesn't click.
#[derive(Default)]
pub struct PluginProcessor {
    /// The last block's gain, where the next ramp starts.
    gain: f32,
}

fn target(params: &Parameters) -> f32 {
    if params.bypass { 1.0 } else { params.gain }
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.gain = target(ctx.params);
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let target = target(ctx.params);
        let frames = ctx.audio.frames();
        let step = if frames == 0 {
            0.0
        } else {
            (target - self.gain) / frames as f32
        };
        for channel in ctx.audio.channels() {
            let mut gain = self.gain;
            for sample in channel {
                *sample *= gain;
                gain += step;
            }
        }
        self.gain = target;
    }
}
