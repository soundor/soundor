//! A small, deliberately bounded polyphonic synth and a controller MIDI monitor.
use soundor::prelude::*;
use soundor::types::MidiStats;

#[derive(Clone, Copy, Default)]
struct Voice {
    channel: u8,
    note: u8,
    velocity: u8,
    phase: f64,
    increment: f64,
}

#[derive(Default)]
pub struct PluginProcessor {
    voices: [Voice; 16],
    samples: Vec<f32>,
    rate: f64,
}

impl PluginProcessor {
    fn message(&mut self, message: MidiMessage) {
        match message {
            MidiMessage::NoteOn {
                channel,
                note,
                velocity,
            } if velocity != 0 => {
                // Retrigger an existing note, otherwise a free voice. At the
                // voice limit steal the oldest slot; no audio-thread allocation.
                let slot = self
                    .voices
                    .iter()
                    .position(|v| v.channel == channel && v.note == note)
                    .or_else(|| self.voices.iter().position(|v| v.velocity == 0))
                    .unwrap_or(0);
                self.voices[slot] = Voice {
                    channel,
                    note,
                    velocity,
                    phase: 0.0,
                    increment: 440.0 * 2.0f64.powf((note as f64 - 69.0) / 12.0) / self.rate,
                };
            }
            MidiMessage::NoteOn { channel, note, .. }
            | MidiMessage::NoteOff { channel, note, .. } => {
                for voice in &mut self.voices {
                    if voice.channel == channel && voice.note == note {
                        voice.velocity = 0;
                    }
                }
            }
            MidiMessage::ControlChange {
                channel,
                controller: 120 | 123,
                ..
            } => {
                for voice in &mut self.voices {
                    if voice.channel == channel {
                        voice.velocity = 0;
                    }
                }
            }
            _ => {}
        }
    }
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.samples.resize(ctx.max_frames, 0.0);
        self.rate = ctx.sample_rate;
        self.reset();
    }
    fn reset(&mut self) {
        self.voices.fill(Voice::default());
    }
    fn process(&mut self, ctx: &mut ProcessContext) {
        let mut next = 0;
        for frame in 0..ctx.audio.frames() {
            while let Some(event) = ctx.midi.input().get(next).copied() {
                if event.sample_offset as usize > frame {
                    break;
                }
                self.message(event.message);
                // Observation is explicit. This synth never echoes input to host output.
                let _ = ctx.midi.publish(event);
                next += 1;
            }
            let mut sample = 0.0;
            for voice in &mut self.voices {
                if voice.velocity == 0 {
                    continue;
                }
                sample += (voice.phase * std::f64::consts::TAU).sin() as f32
                    * voice.velocity as f32
                    / 127.0
                    * 0.04;
                voice.phase = (voice.phase + voice.increment).fract();
            }
            self.samples[frame] = sample;
        }
        for channel in ctx.audio.channels() {
            channel.copy_from_slice(&self.samples[..channel.len()]);
        }
    }
}

#[derive(Default)]
pub struct Local {
    events: u32,
    resets: u32,
}
pub struct PluginController;
impl Controller for PluginController {
    type Local = Local;
    type Shared = ();
    const MIDI_INPUT: bool = true;
    fn midi(ctx: &mut TaskContext<Self>, batch: soundor::midi::MidiBatch) {
        ctx.store.local.events = ctx
            .store
            .local
            .events
            .saturating_add(batch.events.len() as u32);
        if batch.reset {
            ctx.store.local.resets = ctx.store.local.resets.saturating_add(1);
        }
    }
}
impl NativeMethods for PluginController {
    fn stats(ctx: &mut TaskContext<Self>) -> MidiStats {
        MidiStats {
            events: ctx.store.local.events,
            resets: ctx.store.local.resets,
        }
    }
    fn play_note(ctx: &mut TaskContext<Self>, note: u8, down: bool) -> bool {
        ctx.midi
            .send(MidiMessage::NoteOn {
                channel: 1,
                note,
                velocity: if down { 96 } else { 0 },
            })
            .is_ok()
    }
}
soundor::export!(PluginProcessor, PluginController);
