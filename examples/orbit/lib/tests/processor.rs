//! Orbit's processor through Soundor's testing harness: parameters by id, as
//! the runtimes pass them, and the host's transport.

use orbit::PluginProcessor;
use soundor::testing::{Status, TestProcessor};

const RATE: f64 = 48_000.0;

/// The first voice alone and fully wet, with no drift or repeats, the filter
/// wide open, and free time (500 ms a beat).
fn one_voice() -> TestProcessor<PluginProcessor> {
    TestProcessor::<PluginProcessor>::new()
        .sample_rate(RATE)
        .block_size(512)
        .parameter("sync", 0.0)
        .parameter("mix", 1.0)
        .parameter("motion", 0.0)
        .parameter("tone", 1.0)
        .parameter("feedback", 0.0)
        .parameter("level1", 1.0)
        .parameter("level2", 0.0)
        .parameter("level3", 0.0)
        .parameter("time1", 1.0)
        .build()
}

fn settle(processor: &mut TestProcessor<PluginProcessor>) {
    processor.process(&[vec![0.0; RATE as usize], vec![0.0; RATE as usize]]);
}

fn peak_frame(channel: &[f32]) -> usize {
    (0..channel.len())
        .max_by(|a, b| channel[*a].abs().total_cmp(&channel[*b].abs()))
        .unwrap()
}

fn impulse(frames: usize) -> Vec<f32> {
    let mut samples = vec![0.0; frames];
    samples[0] = 0.5;
    samples
}

#[test]
fn an_echo_comes_back_after_its_time_in_beats() {
    let mut processor = one_voice();
    settle(&mut processor);
    let click = impulse(RATE as usize);
    let output = processor.process(&[click.clone(), click]);
    // One beat of free time: half a second.
    assert!(peak_frame(&output[0]).abs_diff(RATE as usize / 2) <= 2);
}

#[test]
fn with_tempo_sync_an_echo_follows_the_host_tempo() {
    let mut processor = one_voice();
    processor.set_parameter("sync", 1.0);
    processor.transport_mut().tempo = Some(60.0);
    settle(&mut processor);
    let click = impulse(RATE as usize * 3 / 2);
    let output = processor.process(&[click.clone(), click]);
    // One beat at 60 BPM: a second.
    assert!(peak_frame(&output[0]).abs_diff(RATE as usize) <= 2);
}

#[test]
fn bypass_returns_the_dry_signal() {
    let mut processor = one_voice();
    processor.set_parameter("bypass", 1.0);
    settle(&mut processor);
    let output = processor.process(&[vec![0.25; 64], vec![-0.125; 64]]);
    assert!(output[0].iter().all(|sample| (sample - 0.25).abs() < 1e-5));
    assert!(output[1].iter().all(|sample| (sample + 0.125).abs() < 1e-5));
}

#[test]
fn mono_folds_both_sides_into_one() {
    let mut processor = TestProcessor::<PluginProcessor>::new()
        .layout(&[1], &[1])
        .parameter("bypass", 1.0)
        .build();
    processor.process(&[vec![0.0; RATE as usize]]);
    let output = processor.process(&[vec![0.5; 16]]);
    assert!(output[0].iter().all(|sample| (sample - 0.5).abs() < 1e-5));
}

#[test]
fn reset_forgets_the_echoes() {
    let mut processor = one_voice();
    settle(&mut processor);
    processor.process(&[impulse(256), impulse(256)]);
    assert_eq!(processor.reset(), Status::Ok);
    let output = processor.process(&[vec![0.0; RATE as usize], vec![0.0; RATE as usize]]);
    assert!(output.iter().flatten().all(|sample| *sample == 0.0));
}

#[test]
fn stays_finite_at_maximum_feedback_and_hold() {
    let mut processor = TestProcessor::<PluginProcessor>::new()
        .parameter("feedback", 0.92)
        .parameter("mix", 1.0)
        .build();
    let noise: Vec<f32> = (0..RATE as usize)
        .map(|i| ((i * 7919) % 2000) as f32 / 1000.0 - 1.0)
        .collect();
    processor.process(&[noise.clone(), noise]);
    processor.set_parameter("hold", 1.0);
    let held = processor.process(&[vec![0.0; RATE as usize * 2], vec![0.0; RATE as usize * 2]]);
    assert!(
        held.iter()
            .flatten()
            .all(|sample| sample.is_finite() && sample.abs() <= 2.0)
    );
}
