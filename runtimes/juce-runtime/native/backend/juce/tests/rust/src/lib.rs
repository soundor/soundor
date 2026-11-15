//! A processor for the JUCE adapter's tests: the main bus times `gain`, the
//! sidechain doubled into a second output bus when there is one, `peak`
//! published, both channels filled, and a panic at `gain` 2.

use soundor::prelude::*;

#[derive(Default)]
pub struct Processor {
    max_frames: usize,
}

impl AudioProcessor for Processor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.max_frames = ctx.max_frames;
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
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
        ctx.publish.peak(if peak > 0.0 { (20.0 * peak.log10()).clamp(-96.0, 0.0) } else { -96.0 });
        ctx.channels.level.publish(peak);
        ctx.channels.history.publish(&[gain, ctx.transport.tempo.unwrap_or(0.0) as f32]);
    }
}

soundor::export!(Processor);
