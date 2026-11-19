//! The VST3 runtime's test plugin: each parameter, state field and MIDI
//! event has an effect its tests (tests/plugin.test.ts) can measure.

use soundor::choices::Mode;
use soundor::prelude::*;

/// output = input × gain × (level × 4), inverted in `invert` mode, untouched
/// when bypassed; notes in come out an octave up; the block's peak is
/// published as `peak` and the `level` stream.
#[derive(Default)]
pub struct PluginProcessor;

impl Processor for PluginProcessor {
    fn prepare(&mut self, _ctx: &PrepareContext) {}

    fn process(&mut self, ctx: &mut ProcessContext) {
        let mut factor = ctx.params.gain * ctx.state.level * 4.0;
        if ctx.params.mode == Mode::Invert {
            factor = -factor;
        }
        let mut peak = 0.0f32;
        for channel in ctx.audio.channels() {
            for sample in channel {
                if !ctx.params.bypass {
                    *sample *= factor;
                }
                peak = peak.max(sample.abs());
            }
        }
        ctx.publish.peak(peak.min(4.0));
        ctx.streams.level.publish(peak);
        let input = ctx.midi.input().to_vec();
        for event in input {
            let message = match event.message {
                MidiMessage::NoteOn { channel, note, velocity } => {
                    MidiMessage::NoteOn { channel, note: note.saturating_add(12).min(127), velocity }
                }
                MidiMessage::NoteOff { channel, note, velocity } => {
                    MidiMessage::NoteOff { channel, note: note.saturating_add(12).min(127), velocity }
                }
                other => other,
            };
            let _ = ctx.midi.output().push(MidiEvent { message, ..event });
        }
    }
}

/// The controller: `twice` doubles its argument.
pub struct PluginController;

impl Controller for PluginController {
    type Local = ();
    type Shared = ();
}

impl NativeMethods for PluginController {
    fn twice(ctx: &mut TaskContext<Self>, value: i32) -> i32 {
        let value = value.wrapping_mul(2);
        ctx.events.doubled(events::DoubledEvent { value });
        value
    }
}

soundor::export!(PluginProcessor, PluginController);
