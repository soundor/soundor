//! MIDI 1.0 channel messages. Channels are 1–16, data 0–127, pitch bend
//! 0–16383 (centre 8192). Note On with velocity zero remains Note On.

/// A channel message, without delivery metadata.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
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

/// Maximum events in each processor input, output and publication buffer.
pub const MIDI_CAPACITY: usize = 1024;

const EMPTY: MidiEvent = MidiEvent {
    message: MidiMessage::NoteOff {
        channel: 1,
        note: 0,
        velocity: 0,
    },
    sample_offset: 0,
    source: None,
};

/// Why an event could not be accepted. A full buffer requests recovery:
/// processing is reset before the next block so a lost release cannot leave
/// a processor voice active indefinitely.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MidiError {
    /// The message or its offset is invalid.
    Invalid,
    /// Fixed storage is full; the event was refused.
    Full,
    /// The processor is not prepared or has been destroyed.
    Inactive,
    /// This destination already has a consumer.
    AlreadySubscribed,
}

pub(crate) struct EventBuffer {
    events: [MidiEvent; MIDI_CAPACITY],
    length: usize,
    pub dropped: u64,
}

impl Default for EventBuffer {
    fn default() -> Self {
        Self {
            events: [EMPTY; MIDI_CAPACITY],
            length: 0,
            dropped: 0,
        }
    }
}

impl EventBuffer {
    pub fn clear(&mut self) {
        self.length = 0;
    }
    pub fn events(&self) -> &[MidiEvent] {
        &self.events[..self.length]
    }
    // Stable insertion: preserves producer order at the same sample. No
    // allocation (slice::sort's implementation may allocate).
    pub fn push(&mut self, event: MidiEvent) -> Result<(), MidiError> {
        if event.message.encode().is_err() {
            return Err(MidiError::Invalid);
        }
        if self.length == MIDI_CAPACITY {
            self.dropped = self.dropped.saturating_add(1);
            return Err(MidiError::Full);
        }
        let position = self
            .events()
            .partition_point(|previous| previous.sample_offset <= event.sample_offset);
        self.events.copy_within(position..self.length, position + 1);
        self.events[position] = event;
        self.length += 1;
        Ok(())
    }
}

/// The block's MIDI, borrowed independently of its audio. Input is never
/// automatically echoed or published; the processor chooses what to send.
pub struct Midi<'a> {
    pub(crate) input: &'a [MidiEvent],
    pub(crate) output: MidiOutput<'a>,
    pub(crate) publication: MidiOutput<'a>,
    pub(crate) dropped: u64,
}

impl<'a> Midi<'a> {
    /// Ordered by offset, then arrival order. UI/controller messages arrive
    /// at offset zero of the next block, without sample scheduling promises.
    pub fn input(&self) -> &[MidiEvent] {
        self.input
    }
    /// Explicit output to the host; storage exists even if host output is off.
    pub fn output(&mut self) -> &mut MidiOutput<'a> {
        &mut self.output
    }
    /// Explicit publication to opted-in control-thread observers. Independent
    /// of host output; incoming messages are never published automatically.
    pub fn publish(&mut self, event: MidiEvent) -> Result<(), MidiError> {
        self.publication.push(event)
    }
    /// Cumulative lost input events; a change means reset was requested.
    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

/// Fixed output storage with explicit errors. Invalid offsets are refused,
/// never moved to zero. For a zero-frame block only offset zero is valid.
pub struct MidiOutput<'a> {
    pub(crate) buffer: &'a mut EventBuffer,
    pub(crate) frames: usize,
    pub(crate) base: u32,
}

impl MidiOutput<'_> {
    /// Adds an event in block order. On saturation, returns `Full`, counts
    /// the loss and requests processor reset before the following block.
    pub fn push(&mut self, mut event: MidiEvent) -> Result<(), MidiError> {
        if !valid_offset(event.sample_offset, self.frames) {
            return Err(MidiError::Invalid);
        }
        event.sample_offset += self.base;
        self.buffer.push(event)
    }
    /// Cumulative events refused because this output was full.
    pub fn dropped(&self) -> u64 {
        self.buffer.dropped
    }
}

pub(crate) fn valid_offset(offset: u32, frames: usize) -> bool {
    if frames == 0 {
        offset == 0
    } else {
        (offset as usize) < frames
    }
}

pub(crate) struct MidiStorage {
    pub incoming: std::sync::Arc<MidiInbox>,
    pub seen_dropped: u64,
    pub input: EventBuffer,
    pub chunk: EventBuffer,
    pub output: EventBuffer,
    pub publication: EventBuffer,
    pub recovery: bool,
    pub last_dropped: u64,
}

impl Default for MidiStorage {
    fn default() -> Self {
        Self {
            incoming: std::sync::Arc::new(MidiInbox::default()),
            seen_dropped: 0,
            input: EventBuffer::default(),
            chunk: EventBuffer::default(),
            output: EventBuffer::default(),
            publication: EventBuffer::default(),
            recovery: false,
            last_dropped: 0,
        }
    }
}

impl MidiStorage {
    pub fn reset(&mut self) {
        self.incoming
            .recover
            .store(false, std::sync::atomic::Ordering::Release);
        self.incoming
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::Release);
        self.incoming.queue.drain(|_| {});
        self.input.clear();
        self.chunk.clear();
        self.output.clear();
        self.publication.clear();
        self.recovery = false;
    }
    pub fn chunk(&mut self, offset: usize, frames: usize) {
        self.chunk.clear();
        for event in self.input.events() {
            let position = event.sample_offset as usize;
            if position >= offset
                && (position < offset + frames || (frames == 0 && position == offset))
            {
                let mut event = *event;
                event.sample_offset -= offset as u32;
                // A subrange cannot contain more events than the input.
                let _ = self.chunk.push(event);
            }
        }
    }
    pub fn context(&mut self, frames: usize, base: u32) -> Midi<'_> {
        Midi {
            input: self.chunk.events(),
            output: MidiOutput {
                buffer: &mut self.output,
                frames,
                base,
            },
            publication: MidiOutput {
                buffer: &mut self.publication,
                frames,
                base,
            },
            dropped: self.input.dropped,
        }
    }
}

/// A bounded MIDI mailbox. Producers serialize with a single nonblocking
/// attempt; the consumer never takes their gate. Atomic slots let the
/// consumer read without aliasing or locks. Queue storage is fixed, and
/// producer contention is reported just like saturation.
pub(crate) struct MidiQueue {
    slots: [std::sync::atomic::AtomicU64; MIDI_CAPACITY],
    tags: [std::sync::atomic::AtomicU64; MIDI_CAPACITY],
    head: std::sync::atomic::AtomicUsize,
    tail: std::sync::atomic::AtomicUsize,
    producer: std::sync::atomic::AtomicBool,
    pub dropped: std::sync::atomic::AtomicU64,
}

impl Default for MidiQueue {
    fn default() -> Self {
        Self {
            slots: std::array::from_fn(|_| std::sync::atomic::AtomicU64::new(0)),
            tags: std::array::from_fn(|_| std::sync::atomic::AtomicU64::new(0)),
            head: std::sync::atomic::AtomicUsize::new(0),
            tail: std::sync::atomic::AtomicUsize::new(0),
            producer: std::sync::atomic::AtomicBool::new(false),
            dropped: std::sync::atomic::AtomicU64::new(0),
        }
    }
}

impl MidiQueue {
    pub fn push(&self, event: MidiEvent) -> Result<(), MidiError> {
        self.push_tagged(event, 0)
    }

    fn push_tagged(&self, event: MidiEvent, tag: u64) -> Result<(), MidiError> {
        use std::sync::atomic::Ordering::*;
        let (bytes, _) = event.message.encode().map_err(|_| MidiError::Invalid)?;
        if self
            .producer
            .compare_exchange(false, true, Acquire, Relaxed)
            .is_err()
        {
            self.dropped.fetch_add(1, Relaxed);
            return Err(MidiError::Full);
        }
        let tail = self.tail.load(Relaxed);
        if tail.wrapping_sub(self.head.load(Acquire)) == MIDI_CAPACITY {
            self.producer.store(false, Release);
            self.dropped.fetch_add(1, Relaxed);
            return Err(MidiError::Full);
        }
        let source = match event.source {
            None => 0,
            Some(MidiSource::Host) => 1,
            Some(MidiSource::Ui) => 2,
            Some(MidiSource::Controller) => 3,
        };
        let packed = u64::from(event.sample_offset) << 32
            | (source << 24)
            | u64::from(bytes[2]) << 16
            | u64::from(bytes[1]) << 8
            | u64::from(bytes[0]);
        self.slots[tail % MIDI_CAPACITY].store(packed, Relaxed);
        self.tags[tail % MIDI_CAPACITY].store(tag, Relaxed);
        self.tail.store(tail.wrapping_add(1), Release);
        self.producer.store(false, Release);
        Ok(())
    }

    // Single consumer, called at most once per queue per block/tick. It
    // drains a bounded snapshot, so concurrent producers cannot extend work.
    pub fn drain(&self, mut receive: impl FnMut(MidiEvent)) {
        self.drain_tagged(|event, _| receive(event));
    }

    fn drain_tagged(&self, mut receive: impl FnMut(MidiEvent, u64)) {
        use std::sync::atomic::Ordering::*;
        let mut head = self.head.load(Relaxed);
        let tail = self.tail.load(Acquire);
        while head != tail {
            let packed = self.slots[head % MIDI_CAPACITY].load(Relaxed);
            let bytes = [packed as u8, (packed >> 8) as u8, (packed >> 16) as u8];
            let kind = bytes[0] >> 4;
            let length = if kind == 12 || kind == 13 { 2 } else { 3 };
            // Only validated producer data can reach these slots.
            if let Ok(message) = MidiMessage::decode(&bytes[..length]) {
                receive(
                    MidiEvent {
                        message,
                        sample_offset: (packed >> 32) as u32,
                        source: match (packed >> 24) & 255 {
                            1 => Some(MidiSource::Host),
                            2 => Some(MidiSource::Ui),
                            3 => Some(MidiSource::Controller),
                            _ => None,
                        },
                    },
                    self.tags[head % MIDI_CAPACITY].load(Relaxed),
                );
            }
            head = head.wrapping_add(1);
        }
        self.head.store(head, Release);
    }
}

#[cfg(test)]
mod queue_tests {
    use super::*;

    #[test]
    fn bounded_queue_recovers_and_retains_order() {
        let queue = MidiQueue::default();
        for offset in 0..MIDI_CAPACITY {
            queue
                .push(MidiEvent {
                    sample_offset: offset as u32,
                    ..EMPTY
                })
                .unwrap();
        }
        assert_eq!(queue.push(EMPTY), Err(MidiError::Full));
        let mut expected = 0;
        queue.drain(|event| {
            assert_eq!(event.sample_offset, expected);
            expected += 1;
        });
        assert_eq!(expected as usize, MIDI_CAPACITY);
        queue.push(EMPTY).unwrap();
        let mut count = 0;
        queue.drain(|_| count += 1);
        assert_eq!(count, 1);
    }
}

#[derive(Default)]
pub(crate) struct MidiInbox {
    pub(crate) recover: std::sync::atomic::AtomicBool,
    queue: MidiQueue,
    ui: ObserverQueue,
    controller: ObserverQueue,
    generation: std::sync::atomic::AtomicU64,
    pub active: std::sync::atomic::AtomicBool,
}

/// A cloneable nonblocking sender, safe for multiple producers. Delivery is
/// at offset zero of the next block. Clones become inactive when the
/// processor is destroyed. Contention or capacity exhaustion returns `Full`
/// and requests recovery, rather than waiting on the audio thread.
#[derive(Clone)]
pub struct MidiSender {
    pub(crate) inbox: std::sync::Arc<MidiInbox>,
    pub(crate) source: MidiSource,
    pub(crate) lifetime: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}

impl MidiSender {
    /// Queues a typed message. Failure is explicit; do not assume a failed
    /// Note On/Off was delivered. No allocation or blocking.
    pub fn send(&self, message: MidiMessage) -> Result<(), MidiError> {
        if self
            .lifetime
            .as_ref()
            .is_some_and(|live| !live.load(std::sync::atomic::Ordering::Acquire))
        {
            return Err(MidiError::Inactive);
        }
        if !self.inbox.active.load(std::sync::atomic::Ordering::Acquire) {
            return Err(MidiError::Inactive);
        }
        self.inbox.queue.push(MidiEvent {
            message,
            sample_offset: 0,
            source: Some(self.source),
        })
    }
}

impl MidiStorage {
    pub fn sender(&self, source: MidiSource) -> MidiSender {
        MidiSender {
            inbox: self.incoming.clone(),
            source,
            lifetime: None,
        }
    }
    pub fn receive(&mut self) {
        use std::sync::atomic::Ordering::Acquire;
        if self
            .incoming
            .recover
            .swap(false, std::sync::atomic::Ordering::AcqRel)
        {
            self.recovery = true;
        }
        let dropped = self.incoming.queue.dropped.load(Acquire);
        if dropped != self.seen_dropped {
            self.seen_dropped = dropped;
            self.input.dropped = self.input.dropped.saturating_add(1);
            self.recovery = true;
        }
        self.incoming.queue.drain(|event| {
            if self.input.push(event).is_err() {
                self.recovery = true;
            }
        });
    }
}

#[cfg(test)]
mod concurrent_tests {
    use super::*;
    #[test]
    fn fan_in_preserves_each_producers_order() {
        let queue = std::sync::Arc::new(MidiQueue::default());
        let mut threads = Vec::new();
        for source in 0..4 {
            let queue = queue.clone();
            threads.push(std::thread::spawn(move || {
                for n in 0..256 {
                    let event = MidiEvent {
                        message: MidiMessage::ControlChange {
                            channel: source + 1,
                            controller: 1,
                            value: 0,
                        },
                        sample_offset: n,
                        source: None,
                    };
                    while queue.push(event).is_err() {
                        std::thread::yield_now();
                    }
                }
            }));
        }
        let mut expected = [0; 4];
        while expected.iter().sum::<u32>() < 1024 {
            queue.drain(|event| {
                let MidiMessage::ControlChange { channel, .. } = event.message else {
                    panic!("wrong message")
                };
                let next = &mut expected[channel as usize - 1];
                assert_eq!(event.sample_offset, *next);
                *next += 1;
            });
            std::thread::yield_now();
        }
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(expected, [256; 4]);
    }
}

#[derive(Default)]
struct ObserverQueue {
    queue: MidiQueue,
    subscription: std::sync::atomic::AtomicU64,
}

/// A batch explicitly published by the processor. Delivery takes place on
/// the subscriber's thread, never within the audio callback.
#[derive(Debug)]
pub struct MidiBatch {
    /// Ordered messages. No automatic echo of processor input.
    pub events: Vec<MidiEvent>,
    /// Cumulative dropped observations at this destination.
    pub dropped: u64,
    /// Reset/discontinuity or lost observations: clear active-note display
    /// state before applying subsequent events. The discontinuous batch is
    /// discarded, rather than delivering potentially unmatched notes.
    pub reset: bool,
}

/// One control-thread consumer. Dropping it unsubscribes. Each destination
/// has one receiver; a UI runtime fans its receiver out to its JS listeners.
/// It may move between threads, but cannot be shared for concurrent reads.
pub struct MidiReceiver {
    inbox: std::sync::Arc<MidiInbox>,
    controller: bool,
    subscription: u64,
    generation: u64,
    dropped: u64,
    _single_consumer: std::marker::PhantomData<std::cell::Cell<()>>,
}

impl MidiReceiver {
    fn queue(&self) -> &ObserverQueue {
        if self.controller {
            &self.inbox.controller
        } else {
            &self.inbox.ui
        }
    }
    /// Drains one bounded snapshot. Allocates only on the consumer thread.
    pub fn receive(&mut self) -> MidiBatch {
        use std::sync::atomic::Ordering::Acquire;
        let dropped = self.queue().queue.dropped.load(Acquire);
        let generation = self.inbox.generation.load(Acquire);
        let reset = dropped != self.dropped || generation != self.generation;
        let mut events = Vec::new();
        self.queue().queue.drain_tagged(|event, subscription| {
            if !reset && subscription == self.subscription {
                events.push(event);
            }
        });
        self.generation = generation;
        self.dropped = dropped;
        MidiBatch {
            events,
            dropped,
            reset,
        }
    }
}
impl Drop for MidiReceiver {
    fn drop(&mut self) {
        self.queue().subscription.store(
            self.subscription.wrapping_add(1),
            std::sync::atomic::Ordering::Release,
        );
    }
}
impl MidiInbox {
    pub fn subscribe(
        self: &std::sync::Arc<Self>,
        controller: bool,
    ) -> Result<MidiReceiver, MidiError> {
        use std::sync::atomic::Ordering::*;
        let queue = if controller {
            &self.controller
        } else {
            &self.ui
        };
        let previous = queue.subscription.load(Acquire);
        if previous & 1 != 0 {
            return Err(MidiError::AlreadySubscribed);
        }
        let subscription = previous.wrapping_add(1);
        if queue
            .subscription
            .compare_exchange(previous, subscription, AcqRel, Acquire)
            .is_err()
        {
            return Err(MidiError::AlreadySubscribed);
        }
        Ok(MidiReceiver {
            inbox: self.clone(),
            controller,
            subscription,
            generation: self.generation.load(Acquire),
            dropped: queue.queue.dropped.load(Acquire),
            _single_consumer: std::marker::PhantomData,
        })
    }
    pub fn publish(&self, event: MidiEvent) {
        for observer in [&self.ui, &self.controller] {
            let subscription = observer
                .subscription
                .load(std::sync::atomic::Ordering::Acquire);
            if subscription & 1 != 0 {
                let _ = observer.queue.push_tagged(event, subscription);
            }
        }
    }
}
impl MidiStorage {
    pub fn deliver(&self) {
        for &event in self.publication.events() {
            self.incoming.publish(event);
        }
    }
}

impl MidiStorage {
    pub fn generation(&self) -> u64 {
        self.incoming
            .generation
            .load(std::sync::atomic::Ordering::Acquire)
    }
}

#[cfg(target_arch = "wasm32")]
impl MidiInbox {
    pub(crate) fn set_active(&self, active: bool) {
        self.active
            .store(active, std::sync::atomic::Ordering::Release);
        if !active {
            self.queue.drain(|_| {});
            self.generation
                .fetch_add(1, std::sync::atomic::Ordering::Release);
        }
    }
    pub(crate) fn take_outgoing(&self) -> (Vec<MidiEvent>, u64) {
        let mut events = Vec::new();
        self.queue.drain(|event| events.push(event));
        (
            events,
            self.queue
                .dropped
                .load(std::sync::atomic::Ordering::Acquire),
        )
    }
    pub(crate) fn discontinuity(&self) {
        self.generation
            .fetch_add(1, std::sync::atomic::Ordering::Release);
    }
}
