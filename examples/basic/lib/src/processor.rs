//! The plugin's audio processing. Soundor's runtimes run it: the VST3
//! plugin natively, the Web host compiled to WebAssembly, in an AudioWorklet.
//! Its parameters are soundor.config.ts's, typed: `ctx.params.gain`.

use soundor::prelude::*;

/// Applies the `gain` parameter as a linear gain, ramping from one block's
/// value to the next so that automation doesn't click.
#[derive(Default)]
pub struct PluginProcessor {
    /// The last block's gain, where the next ramp starts.
    gain: f32,
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        // Start from the current value, rather than gliding up from silence.
        self.gain = ctx.params.gain;
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let target = ctx.params.gain;
        let frames = ctx.audio.frames();
        let step = if frames == 0 {
            0.0
        } else {
            (target - self.gain) / frames as f32
        };
        // The main output holds the main input: process it in place.
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
