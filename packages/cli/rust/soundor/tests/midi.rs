use soundor::midi::MIDI_CAPACITY;
use soundor::prelude::*;
use soundor::testing::{CountingAllocator, TestProcessor};

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[derive(Default)]
struct Echo {
    resets: usize,
    active: usize,
}
impl Processor for Echo {
    fn prepare(&mut self, _: &PrepareContext) {}
    fn reset(&mut self) {
        self.resets += 1;
        self.active = 0;
    }
    fn process(&mut self, ctx: &mut ProcessContext) {
        for i in 0..ctx.midi.input().len() {
            let event = ctx.midi.input()[i];
            match event.message {
                MidiMessage::NoteOn { velocity: 1.., .. } => self.active += 1,
                MidiMessage::NoteOn { velocity: 0, .. } | MidiMessage::NoteOff { .. } => {
                    self.active = self.active.saturating_sub(1)
                }
                _ => {}
            }
            let _ = ctx.midi.output().push(event);
            let _ = ctx.midi.publish(event);
        }
    }
}
fn note(offset: u32, note: u8) -> MidiEvent {
    MidiEvent {
        message: MidiMessage::NoteOn {
            channel: 1,
            note,
            velocity: 100,
        },
        sample_offset: offset,
        source: Some(MidiSource::Host),
    }
}

#[test]
fn stable_sample_order_and_zero_allocations() {
    let mut p = TestProcessor::<Echo>::new().block_size(64).build();
    for (offset, pitch) in [(63, 60), (0, 62), (0, 64), (32, 65)] {
        p.midi_input(note(offset, pitch)).unwrap();
    }
    p.process_silence(64);
    assert_eq!(
        p.midi_output(),
        &[note(0, 62), note(0, 64), note(32, 65), note(63, 60)]
    );
    assert_eq!(p.midi_output(), p.midi_publications());
    assert_eq!(p.allocations(), 0);
}

#[test]
fn larger_blocks_rebase_events_for_each_chunk() {
    let mut p = TestProcessor::<Echo>::new().block_size(32).build();
    p.midi_input(note(65, 60)).unwrap();
    assert_eq!(p.process_silence(96), soundor::ffi::Status::Ok);
    assert_eq!(p.midi_output(), &[note(65, 60)]);
    assert_eq!(p.allocations(), 0);
}

#[test]
fn invalid_offsets_are_rejected_without_retiming() {
    for frames in [0, 1, 32, 128] {
        let mut p = TestProcessor::<Echo>::new().build();
        p.midi_input(note(if frames == 0 { 1 } else { frames as u32 }, 60))
            .unwrap();
        assert_eq!(
            p.process_silence(frames),
            soundor::ffi::Status::InvalidArgument
        );
        assert!(p.midi_output().is_empty());
        assert_eq!(p.process_silence(frames), soundor::ffi::Status::Ok);
    }
}

#[test]
fn zero_frames_accept_zero_offset() {
    let mut p = TestProcessor::<Echo>::new().build();
    p.midi_input(note(0, 60)).unwrap();
    assert_eq!(p.process_silence(0), soundor::ffi::Status::Ok);
    assert_eq!(p.midi_output(), &[note(0, 60)]);
}

#[test]
fn saturation_resets_active_voices_and_discards_partial_input() {
    let mut p = TestProcessor::<Echo>::new().build();
    p.midi_input(note(0, 60)).unwrap();
    p.process_silence(64);
    assert_eq!(p.processor().active, 1);
    for _ in 0..MIDI_CAPACITY {
        p.midi_input(note(0, 60)).unwrap();
    }
    assert_eq!(p.midi_input(note(0, 60)), Err(MidiError::Full));
    p.process_silence(64);
    assert_eq!(p.processor().active, 0);
    assert_eq!(p.processor().resets, 1);
    assert!(p.midi_output().is_empty());
    assert_eq!(p.allocations(), 0);
}

#[test]
fn internal_sender_timing_overflow_and_lifecycle() {
    let mut p = TestProcessor::<Echo>::new().build();
    let sender = p.midi_sender(MidiSource::Controller);
    sender.send(note(0, 60).message).unwrap();
    p.process_silence(64);
    assert_eq!(p.midi_output()[0].source, Some(MidiSource::Controller));
    assert_eq!(p.midi_output()[0].sample_offset, 0);
    for _ in 0..MIDI_CAPACITY {
        sender.send(note(0, 60).message).unwrap();
    }
    assert_eq!(sender.send(note(0, 60).message), Err(MidiError::Full));
    p.process_silence(64);
    assert_eq!(p.processor().active, 0);
    drop(p);
    assert_eq!(sender.send(note(0, 60).message), Err(MidiError::Inactive));
}

#[derive(Default)]
struct Flood {
    resets: usize,
}
impl Processor for Flood {
    fn prepare(&mut self, _: &PrepareContext) {}
    fn reset(&mut self) {
        self.resets += 1;
    }
    fn process(&mut self, ctx: &mut ProcessContext) {
        for _ in 0..MIDI_CAPACITY {
            ctx.midi.output().push(note(0, 60)).unwrap();
        }
        assert_eq!(ctx.midi.output().push(note(0, 60)), Err(MidiError::Full));
    }
}
#[test]
fn output_capacity_is_explicit_and_overflow_requests_reset() {
    let mut p = TestProcessor::<Flood>::new().build();
    p.process_silence(64);
    assert_eq!(p.midi_output().len(), MIDI_CAPACITY);
    p.process_silence(64);
    assert_eq!(p.processor().resets, 1);
    assert_eq!(p.allocations(), 0);
}
#[test]
fn reset_discards_pending_input_and_reprepare_keeps_senders_valid() {
    let mut p = TestProcessor::<Echo>::new().build();
    let sender = p.midi_sender(MidiSource::Ui);
    sender.send(note(0, 60).message).unwrap();
    p.reset();
    p.process_silence(64);
    assert!(p.midi_output().is_empty());
    p.prepare(48000.0, 64);
    sender.send(note(0, 62).message).unwrap();
    p.process_silence(64);
    assert_eq!(p.midi_output()[0].message, note(0, 62).message);
    assert_eq!(p.allocations(), 0);
}
