//! MIDI 1.0 channel messages. Channels are 1–16, data 0–127, pitch bend
//! 0–16383 (centre 8192). Note On with velocity zero remains Note On.

/// A channel message, without delivery metadata.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MidiMessage {
    /// Starts a note (zero velocity retains its wire representation).
    NoteOn {
        /// Channel, 1–16.
        channel: u8,
        /// Note number, 0–127.
        note: u8,
        /// Velocity, 0–127.
        velocity: u8,
    },
    /// Releases a note.
    NoteOff {
        /// Channel, 1–16.
        channel: u8,
        /// Note number, 0–127.
        note: u8,
        /// Velocity, 0–127.
        velocity: u8,
    },
    /// Changes a controller.
    ControlChange {
        /// Channel, 1–16.
        channel: u8,

        /// Controller number, 0–127.
        controller: u8,

        /// Integer value (bend 0–16383; controller 0–127).
        value: u8,
    },
    /// Absolute bend, centre 8192.
    PitchBend {
        /// Channel, 1–16.
        channel: u8,
        /// Integer value (bend 0–16383; controller 0–127).
        value: u16,
    },
    /// Selects a program, numbered 0–127.
    ProgramChange {
        /// Channel, 1–16.
        channel: u8,
        /// Program, 0–127.
        program: u8,
    },
    /// Pressure for the channel.
    ChannelPressure {
        /// Channel, 1–16.
        channel: u8,
        /// Pressure, 0–127.
        pressure: u8,
    },
    /// Pressure for one note.
    PolyphonicAftertouch {
        /// Channel, 1–16.
        channel: u8,
        /// Note number, 0–127.
        note: u8,
        /// Pressure, 0–127.
        pressure: u8,
    },
}

/// Invalid or unsupported MIDI data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidMidi;

impl MidiMessage {
    /// Encodes a validated message into fixed storage. The returned length
    /// is two or three; the unused byte is zero. Never allocates.
    pub fn encode(self) -> Result<([u8; 3], usize), InvalidMidi> {
        use MidiMessage::*;
        let (kind, channel, a, b) = match self {
            NoteOff {
                channel,
                note,
                velocity,
            } => (8, channel, note, velocity),
            NoteOn {
                channel,
                note,
                velocity,
            } => (9, channel, note, velocity),
            PolyphonicAftertouch {
                channel,
                note,
                pressure,
            } => (10, channel, note, pressure),
            ControlChange {
                channel,
                controller,
                value,
            } => (11, channel, controller, value),
            ProgramChange { channel, program } => (12, channel, program, 0),
            ChannelPressure { channel, pressure } => (13, channel, pressure, 0),
            PitchBend { channel, value } => {
                if value > 16383 {
                    return Err(InvalidMidi);
                }
                (14, channel, (value & 127) as u8, (value >> 7) as u8)
            }
        };
        if !(1..=16).contains(&channel) || a > 127 || b > 127 {
            return Err(InvalidMidi);
        }
        Ok((
            [(kind << 4) | (channel - 1), a, b],
            if kind == 12 || kind == 13 { 2 } else { 3 },
        ))
    }

    /// Decodes one complete message, without running status or system messages.
    pub fn decode(bytes: &[u8]) -> Result<Self, InvalidMidi> {
        let status = *bytes.first().ok_or(InvalidMidi)?;
        let kind = status >> 4;
        let length = if kind == 12 || kind == 13 { 2 } else { 3 };
        if !(8..=14).contains(&kind) || bytes.len() != length || bytes[1..].iter().any(|&v| v > 127)
        {
            return Err(InvalidMidi);
        }
        let channel = (status & 15) + 1;
        let a = bytes[1];
        let b = if length == 3 { bytes[2] } else { 0 };
        Ok(match kind {
            8 => Self::NoteOff {
                channel,
                note: a,
                velocity: b,
            },
            9 => Self::NoteOn {
                channel,
                note: a,
                velocity: b,
            },
            10 => Self::PolyphonicAftertouch {
                channel,
                note: a,
                pressure: b,
            },
            11 => Self::ControlChange {
                channel,
                controller: a,
                value: b,
            },
            12 => Self::ProgramChange {
                channel,
                program: a,
            },
            13 => Self::ChannelPressure {
                channel,
                pressure: a,
            },
            _ => Self::PitchBend {
                channel,
                value: u16::from(a) | (u16::from(b) << 7),
            },
        })
    }
}

/// A source identifier, independent of the message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MidiSource {
    /// Host input (including selected hardware or virtual input).
    Host,
    /// JavaScript UI.
    Ui,
    /// Rust controller.
    Controller,
}

/// A message in the current block. Offsets are samples, relative to its start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MidiEvent {
    /// MIDI data.
    pub message: MidiMessage,
    /// Must be less than the block length (zero for a zero-frame block).
    pub sample_offset: u32,
    /// Origin when known.
    pub source: Option<MidiSource>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_channel_messages_round_trip() {
        for channel in 0..16 {
            for kind in 8..=14 {
                for a in [0, 60, 127] {
                    for b in [0, 100, 127] {
                        let bytes = [(kind << 4) | channel, a, b];
                        let length = if kind == 12 || kind == 13 { 2 } else { 3 };
                        let message = MidiMessage::decode(&bytes[..length]).unwrap();
                        let (encoded, count) = message.encode().unwrap();
                        assert_eq!(&encoded[..count], &bytes[..length]);
                    }
                }
            }
        }
        assert!(matches!(
            MidiMessage::decode(&[0x90, 60, 0]),
            Ok(MidiMessage::NoteOn { velocity: 0, .. })
        ));
    }

    #[test]
    fn rejects_invalid_values() {
        for bytes in [&[0x90, 128, 0][..], &[0xf0, 0, 0], &[0x90, 60], &[]] {
            assert_eq!(MidiMessage::decode(bytes), Err(InvalidMidi));
        }
        for channel in [0, 17, 255] {
            assert!(
                MidiMessage::NoteOn {
                    channel,
                    note: 60,
                    velocity: 100
                }
                .encode()
                .is_err()
            );
        }
        assert!(
            MidiMessage::PitchBend {
                channel: 1,
                value: 16384
            }
            .encode()
            .is_err()
        );
    }
}
