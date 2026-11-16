//! The plugin's audio processing: a ring modulator, the input times a
//! wavetable oscillator at `rate`, mixed by `depth`. The wavetable is an
//! audio resource: `prepare` publishes a sine the first time, and the
//! controller (controller.rs) publishes the ones the UI asks for.

use std::f32::consts::TAU;

use soundor::prelude::*;
use soundor::types::Shape;

mod controller;
pub use controller::{PluginController, within};

/// The wavetable's size when `prepare` makes one.
pub const TABLE_SIZE: usize = 2048;

/// One period of `shape`, `size` samples long, between -1 and 1.
pub fn render(shape: Shape, size: usize) -> Vec<f32> {
    (0..size)
        .map(|index| {
            let phase = index as f32 / size as f32;
            match shape {
                Shape::Sine => (phase * TAU).sin(),
                Shape::Triangle => 1.0 - 4.0 * (phase - 0.5).abs(),
                Shape::Square => {
                    if phase < 0.5 {
                        1.0
                    } else {
                        -1.0
                    }
                }
                Shape::Saw => 2.0 * phase - 1.0,
            }
        })
        .collect()
}

#[derive(Default)]
pub struct PluginProcessor {
    /// Where the oscillator is in its period, from 0 to 1.
    phase: f32,
    published: bool,
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        // Outside the audio thread: allocating is fine. Only the first time:
        // a table the controller published since stays.
        if !self.published {
            ctx.resources
                .wavetable
                .publish(render(Shape::Sine, TABLE_SIZE));
            self.published = true;
        }
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let Some(table) = ctx
            .resources
            .wavetable
            .get()
            .filter(|table| !table.is_empty())
        else {
            return;
        };
        let step = ctx.params.rate / ctx.sample_rate as f32;
        let depth = ctx.params.depth;
        let start = self.phase;
        let mut phase = start;
        for channel in ctx.audio.channels() {
            phase = start;
            for sample in channel {
                let modulator = table[(phase * table.len() as f32) as usize % table.len()];
                *sample *= 1.0 - depth + depth * modulator;
                phase = (phase + step).fract();
            }
        }
        self.phase = phase;
    }

    fn reset(&mut self) {
        self.phase = 0.0;
    }
}

soundor::export!(PluginProcessor, PluginController);
