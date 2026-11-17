use soundor::prelude::*;
use soundor::testing::{CountingAllocator, TestProcessor};
use soundor_midi_arpeggiator::PluginProcessor;
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
fn note(note: u8, velocity: u8, offset: u32) -> MidiEvent {
    MidiEvent {
        message: MidiMessage::NoteOn {
            channel: 1,
            note,
            velocity,
        },
        sample_offset: offset,
        source: None,
    }
}
fn render(block_size: usize) -> Vec<(usize, MidiMessage)> {
    let mut p = TestProcessor::<PluginProcessor>::new()
        .block_size(block_size)
        .build();
    for pitch in [67, 60, 64] {
        p.midi_input(note(pitch, 100, 17)).unwrap();
    }
    let mut events = Vec::new();
    for start in (0..24_000).step_by(block_size) {
        p.process_silence(block_size.min(24_000 - start));
        events.extend(
            p.midi_output()
                .iter()
                .map(|e| (start + e.sample_offset as usize, e.message)),
        );
    }
    assert_eq!(p.allocations(), 0);
    events
}
#[test]
fn exact_timing_is_independent_of_block_size_without_audio_buses() {
    let small = render(64);
    assert_eq!(small, render(512));
    let onsets: Vec<_> = small
        .into_iter()
        .filter_map(|(time, message)| match message {
            MidiMessage::NoteOn { note, .. } => Some((time, note)),
            _ => None,
        })
        .collect();
    assert_eq!(onsets, [(17, 60), (6017, 64), (12017, 67), (18017, 60)]);
}
#[test]
fn zero_velocity_and_reset_leave_no_sounding_notes() {
    let mut p = TestProcessor::<PluginProcessor>::new().build();
    p.midi_input(note(60, 100, 0)).unwrap();
    p.process_silence(128);
    assert!(matches!(
        p.midi_output()[0].message,
        MidiMessage::NoteOn { .. }
    ));
    p.midi_input(note(60, 0, 37)).unwrap();
    p.process_silence(128);
    assert_eq!(p.midi_output().len(), 1);
    assert_eq!(p.midi_output()[0].sample_offset, 37);
    assert!(matches!(
        p.midi_output()[0].message,
        MidiMessage::NoteOff { note: 60, .. }
    ));
    p.reset();
    for _ in 0..100 {
        p.process_silence(128);
        assert!(p.midi_output().is_empty());
    }
    assert_eq!(p.allocations(), 0);
}
