use soundor::prelude::*;
use soundor::testing::{CountingAllocator, TestController, TestProcessor};
use soundor_midi::{PluginController, PluginProcessor};
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
fn note(velocity: u8, sample_offset: u32) -> MidiEvent {
    MidiEvent {
        message: MidiMessage::NoteOn {
            channel: 1,
            note: 69,
            velocity,
        },
        sample_offset,
        source: None,
    }
}
#[test]
fn exact_onset_zero_velocity_release_and_reset_are_allocation_free() {
    let mut p = TestProcessor::<PluginProcessor>::new()
        .block_size(128)
        .build();
    p.midi_input(note(100, 17)).unwrap();
    let audio = p.process(&[vec![0.0; 128], vec![0.0; 128]]);
    assert!(audio[0][..18].iter().all(|sample| *sample == 0.0));
    assert!(audio[0][18..].iter().any(|sample| sample.abs() > 0.001));
    assert_eq!(p.midi_publications()[0].sample_offset, 17);
    assert!(p.midi_output().is_empty());
    p.midi_input(note(0, 23)).unwrap();
    let audio = p.process(&[vec![0.0; 128], vec![0.0; 128]]);
    assert!(audio[0][..23].iter().any(|sample| sample.abs() > 0.001));
    assert!(audio[0][23..].iter().all(|sample| *sample == 0.0));
    p.reset();
    let audio = p.process(&[vec![0.0; 128], vec![0.0; 128]]);
    assert!(audio.iter().flatten().all(|sample| *sample == 0.0));
    assert_eq!(p.allocations(), 0);
}
#[test]
fn controller_sends_and_observes_via_its_pump() {
    let mut p = TestProcessor::<PluginProcessor>::new().build();
    let c = TestController::<PluginController>::for_processor(&p);
    assert!(c.task(|ctx| PluginController::play_note(ctx, 60, true)));
    assert_eq!(c.task(PluginController::stats).events, 0);
    p.process_silence(128);
    c.run_until_idle();
    assert_eq!(c.task(PluginController::stats).events, 1);
    assert!(c.task(|ctx| PluginController::play_note(ctx, 60, false)));
    p.process_silence(128);
    c.run_until_idle();
    assert_eq!(c.task(PluginController::stats).events, 2);
    assert_eq!(p.allocations(), 0);
}
