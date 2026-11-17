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

#[path = "support/controller.rs"]
mod controller;
use controller::PluginController;
use soundor::testing::TestController;

#[test]
fn publications_reach_ui_and_controller_independently_on_the_control_thread() {
    let mut p = TestProcessor::<Echo>::new().build();
    let mut ui = p.subscribe_midi().unwrap();
    let controller = TestController::<PluginController>::for_processor(&p);
    controller.task(|ctx| ctx.midi.send(note(0, 62).message).unwrap());
    p.midi_input(note(11, 60)).unwrap();
    p.process_silence(64);
    // Audio did not invoke controller code.
    controller.task(|ctx| assert!(ctx.store.local.midi.is_empty()));
    controller.run_until_idle();
    let batch = ui.receive();
    assert!(!batch.reset);
    assert_eq!(batch.events.len(), 2);
    assert_eq!(batch.events[0].source, Some(MidiSource::Controller));
    controller.task(|ctx| {
        assert_eq!(ctx.store.local.midi, batch.events);
        assert_eq!(
            ctx.store.local.midi_thread,
            Some(std::thread::current().id())
        );
    });
    assert_eq!(p.allocations(), 0);
}

#[test]
fn closed_subscriptions_never_deliver_previous_subscriptions_events() {
    let mut p = TestProcessor::<Echo>::new().build();
    let ui = p.subscribe_midi().unwrap();
    assert!(matches!(
        p.subscribe_midi(),
        Err(MidiError::AlreadySubscribed)
    ));
    p.midi_input(note(0, 60)).unwrap();
    p.process_silence(64);
    drop(ui);
    let mut ui = p.subscribe_midi().unwrap();
    assert!(ui.receive().events.is_empty());
    p.midi_input(note(0, 62)).unwrap();
    p.process_silence(64);
    assert_eq!(ui.receive().events, vec![note(0, 62)]);
}

#[test]
fn slow_observer_reports_loss_and_discontinuity_without_blocking_audio() {
    let mut p = TestProcessor::<Echo>::new().build();
    let mut ui = p.subscribe_midi().unwrap();
    for _ in 0..2 {
        for _ in 0..MIDI_CAPACITY {
            p.midi_input(note(0, 60)).unwrap();
        }
        p.process_silence(64);
    }
    let batch = ui.receive();
    assert_eq!(batch.dropped, MIDI_CAPACITY as u64);
    assert!(batch.reset);
    assert!(batch.events.is_empty());
    p.midi_input(note(0, 62)).unwrap();
    p.process_silence(64);
    assert_eq!(ui.receive().events, vec![note(0, 62)]);
    assert_eq!(p.allocations(), 0);
}

#[test]
fn controller_shutdown_invalidates_detached_sender_and_unsubscribes() {
    let mut p = TestProcessor::<Echo>::new().build();
    let controller = TestController::<PluginController>::for_processor(&p);
    let sender = controller.async_context().midi.clone();
    sender.send(note(0, 60).message).unwrap();
    p.process_silence(64);
    controller.shutdown();
    assert_eq!(sender.send(note(0, 62).message), Err(MidiError::Inactive));
    let replacement = TestController::<PluginController>::for_processor(&p);
    p.midi_input(note(0, 64)).unwrap();
    p.process_silence(64);
    replacement.run_until_idle();
    replacement.task(|ctx| assert_eq!(ctx.store.local.midi, vec![note(0, 64)]));
}

#[test]
fn processor_destruction_notifies_surviving_observers_and_discards_pending_events() {
    let mut p = TestProcessor::<Echo>::new().build();
    let mut ui = p.subscribe_midi().unwrap();
    p.midi_input(note(0, 60)).unwrap();
    p.process_silence(64);
    drop(p);
    let batch = ui.receive();
    assert!(batch.reset);
    assert!(batch.events.is_empty());
    assert!(!ui.receive().reset);
}
