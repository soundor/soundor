//! Ascending sixteenth-note arpeggiator, scheduled entirely in Rust samples.
use soundor::prelude::*;

pub struct PluginProcessor {
    held: [[bool; 128]; 16],
    cursor: usize,
    sounding: Option<(u8, u8)>,
    countdown: usize,
    step: usize,
}
impl Default for PluginProcessor {
    fn default() -> Self {
        Self {
            held: [[false; 128]; 16],
            cursor: 0,
            sounding: None,
            countdown: 0,
            step: 6000,
        }
    }
}
impl PluginProcessor {
    fn emit(ctx: &mut ProcessContext, message: MidiMessage, frame: usize) {
        let event = MidiEvent {
            message,
            sample_offset: frame as u32,
            source: None,
        };
        // A failed output push requests SDK recovery before the next block.
        let _ = ctx.midi.output().push(event);
        let _ = ctx.midi.publish(event);
    }
    fn release(&mut self, ctx: &mut ProcessContext, frame: usize) {
        if let Some((channel, note)) = self.sounding.take() {
            Self::emit(
                ctx,
                MidiMessage::NoteOff {
                    channel,
                    note,
                    velocity: 0,
                },
                frame,
            );
        }
    }
    fn next_note(&mut self) -> Option<(u8, u8)> {
        for distance in 0..2048 {
            let index = (self.cursor + distance) % 2048;
            if self.held[index / 128][index % 128] {
                self.cursor = (index + 1) % 2048;
                return Some(((index / 128 + 1) as u8, (index % 128) as u8));
            }
        }
        None
    }
}
impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.step = (ctx.sample_rate * 0.125).round().max(1.0) as usize;
        self.reset();
    }
    fn reset(&mut self) {
        self.held = [[false; 128]; 16];
        self.sounding = None;
        self.countdown = 0;
        self.cursor = 0;
        // Runtime reset-generation recovery releases notes at the host/device.
    }
    fn process(&mut self, ctx: &mut ProcessContext) {
        let mut next = 0;
        for frame in 0..ctx.audio.frames() {
            while let Some(event) = ctx.midi.input().get(next).copied() {
                if event.sample_offset as usize > frame {
                    break;
                }
                match event.message {
                    MidiMessage::NoteOn {
                        channel,
                        note,
                        velocity,
                    } => self.held[channel as usize - 1][note as usize] = velocity != 0,
                    MidiMessage::NoteOff { channel, note, .. } => {
                        self.held[channel as usize - 1][note as usize] = false
                    }
                    MidiMessage::ControlChange {
                        channel,
                        controller: 120 | 123,
                        ..
                    } => self.held[channel as usize - 1].fill(false),
                    _ => {}
                }
                next += 1;
            }
            if let Some((channel, note)) = self.sounding
                && !self.held[channel as usize - 1][note as usize]
            {
                self.release(ctx, frame);
            }
            if self.countdown == 0 {
                self.release(ctx, frame);
                if let Some((channel, note)) = self.next_note() {
                    Self::emit(
                        ctx,
                        MidiMessage::NoteOn {
                            channel,
                            note,
                            velocity: 100,
                        },
                        frame,
                    );
                    self.sounding = Some((channel, note));
                    self.countdown = self.step;
                }
            }
            self.countdown = self.countdown.saturating_sub(1);
        }
    }
}
pub struct PluginController;
impl Controller for PluginController {
    type Local = ();
    type Shared = ();
}
soundor::export!(PluginProcessor, PluginController);
