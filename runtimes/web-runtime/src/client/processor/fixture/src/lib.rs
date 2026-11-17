//! A processor for the Web runtime's WebAssembly tests: the main bus times `gain`, the
//! sidechain doubled into a second output bus when there is one, `peak`
//! published, both streams filled (`history`: the gain, the tempo,
//! `processingMode` and the length of `pattern` as the state has them, then
//! the length of the `wavetable` resource `prepare` published), and a panic
//! at `gain` 2.

use soundor::prelude::*;

#[derive(Default)]
pub struct PluginProcessor {
    max_frames: usize,
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.max_frames = ctx.max_frames;
        // A resource prepared outside the audio thread: one element a frame.
        ctx.resources
            .wavetable
            .publish(vec![0.5f32; ctx.max_frames]);
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        for i in 0..ctx.midi.input().len() {
            let event = ctx.midi.input()[i];
            ctx.midi.output().push(event).unwrap();
            ctx.midi.publish(event).unwrap();
        }
        assert!(ctx.audio.frames() <= self.max_frames);
        let gain = ctx.params.gain;
        assert!(gain < 2.0, "the test asked for a panic");
        let mut side = [0.0f32; 4096];
        let frames = ctx.audio.frames().min(side.len());
        if let Some(channel) = ctx.audio.input(1).and_then(|bus| bus.channel(0)) {
            side[..frames].copy_from_slice(&channel[..frames]);
        }
        let mut peak = 0.0f32;
        for channel in ctx.audio.channels() {
            for sample in channel {
                *sample *= gain;
                peak = peak.max(sample.abs());
            }
        }
        if let Some(mut aux) = ctx.audio.output(1)
            && let Some(channel) = aux.channel_mut(0)
        {
            for (sample, side) in channel.iter_mut().zip(side) {
                *sample = side * 2.0;
            }
        }
        ctx.publish.peak(if peak > 0.0 {
            (20.0 * peak.log10()).clamp(-96.0, 0.0)
        } else {
            -96.0
        });
        ctx.streams.level.publish(peak);
        ctx.streams.history.publish(&[
            gain,
            ctx.transport.tempo.unwrap_or(0.0) as f32,
            ctx.state.processing_mode as f32,
            ctx.state.pattern.len() as f32,
            ctx.resources
                .wavetable
                .get()
                .map_or(-1.0, |table| table.len() as f32),
        ]);
    }
}

#[path = "../../../../../../../packages/cli/rust/soundor/tests/support/controller.rs"]
mod controller;
use controller::PluginController;
soundor::export!(PluginProcessor, PluginController);
