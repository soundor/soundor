//! Orbit's audio processing: three echoes that orbit the stereo field
//! (`delay`), set from soundor.config.ts's parameters once a block, their
//! times in beats of the host's tempo when Tempo sync is on.

pub mod delay;

use soundor::prelude::*;

use delay::{Delay, Settings};

#[derive(Default)]
pub struct PluginProcessor {
    delay: Delay,
}

impl PluginProcessor {
    /// The delay's settings for a block: times in seconds, from beats of the
    /// host's tempo (120 BPM when it gives none) or of a fixed 500 ms.
    pub fn settings(params: &Parameters, transport: &Transport) -> Settings {
        let bpm = transport.tempo.unwrap_or(120.0).clamp(20.0, 400.0);
        let beat = if params.sync { 60.0 / bpm } else { 0.5 };
        let time = |value: f32| (f64::from(value) * beat) as f32;
        Settings {
            times: [time(params.time1), time(params.time2), time(params.time3)],
            levels: [params.level1, params.level2, params.level3],
            feedback: params.feedback,
            tone: params.tone,
            motion: params.motion,
            spread: params.spread,
            mix: params.mix,
            hold: params.hold,
            bypass: params.bypass,
        }
    }
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.delay.prepare(ctx.sample_rate);
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let settings = Self::settings(ctx.params, ctx.transport);
        self.delay.configure(&settings);
        let mut channels = ctx.audio.channels();
        let Some(left) = channels.next() else { return };
        match channels.next() {
            Some(right) => {
                for (left, right) in left.iter_mut().zip(right.iter_mut()) {
                    [*left, *right] = self.delay.tick(*left, *right, &settings);
                }
            }
            // Mono: the input to both sides, and both sides back to one.
            None => {
                for sample in left.iter_mut() {
                    let [l, r] = self.delay.tick(*sample, *sample, &settings);
                    *sample = (l + r) * 0.5;
                }
            }
        }
    }

    fn reset(&mut self) {
        self.delay.reset();
    }
}
