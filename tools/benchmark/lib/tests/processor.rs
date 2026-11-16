//! The benchmark plugin's gain processor, tested in plain Rust through
//! Soundor's testing harness: no host, no JUCE, no browser.
//! `cargo test --manifest-path lib/Cargo.toml` (after `soundor gen`).

use soundor::testing::{Status, TestProcessor};
use soundor_benchmark_processor::PluginProcessor;

fn gain(value: f64) -> TestProcessor<PluginProcessor> {
    TestProcessor::<PluginProcessor>::new()
        .sample_rate(48_000.0)
        .block_size(256)
        .parameter("gain", value)
        .build()
}

fn sine(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|frame| (frame as f32 * 0.05).sin() * 0.8)
        .collect()
}

#[test]
fn halves_the_signal_at_half_gain() {
    let output = gain(0.5).process(&[vec![1.0, 0.5, -1.0]]);
    assert_eq!(output[0], [0.5, 0.25, -0.5]);
}

#[test]
fn passes_the_signal_at_unity_gain() {
    let input = sine(1000);
    let output = gain(1.0).process(&[input.clone(), input.clone()]);
    assert_eq!(output, [input.clone(), input]);
}

#[test]
fn silences_at_zero_gain() {
    let output = gain(0.0).process(&[sine(300), sine(300)]);
    assert!(output.iter().flatten().all(|sample| *sample == 0.0));
}

#[test]
fn keeps_the_sign_of_negative_samples() {
    let output = gain(0.25).process(&[vec![-1.0, -0.5, 0.5, -0.0]]);
    assert_eq!(output[0], [-0.25, -0.125, 0.125, -0.0]);
}

#[test]
fn keeps_silence_silent() {
    let output = gain(0.75).process(&[vec![0.0; 512], vec![0.0; 512]]);
    assert!(output.iter().flatten().all(|sample| *sample == 0.0));
}

#[test]
fn gives_the_same_result_at_any_block_size() {
    let input = sine(4096);
    let expected: Vec<f32> = input.iter().map(|sample| sample * 0.3).collect();
    for block_size in [1, 32, 128, 441, 512, 4096] {
        let mut processor = TestProcessor::<PluginProcessor>::new()
            .block_size(block_size)
            .parameter("gain", 0.3)
            .build();
        let output = processor.process(std::slice::from_ref(&input));
        assert_eq!(output[0], expected, "block size {block_size}");
    }
}

#[test]
fn ramps_to_a_new_gain_over_one_block() {
    let mut processor = TestProcessor::<PluginProcessor>::new()
        .block_size(4)
        .parameter("gain", 0.0)
        .build();
    processor.set_parameter("gain", 1.0);
    let ramp = processor.process(&[vec![1.0; 4]]);
    assert_eq!(
        ramp[0],
        [0.0, 0.25, 0.5, 0.75],
        "from the last block's gain"
    );
    let steady = processor.process(&[vec![1.0; 4]]);
    assert_eq!(steady[0], [1.0; 4], "then at the new one");
}

#[test]
fn follows_parameter_changes_between_blocks() {
    let mut processor = gain(1.0);
    for value in [0.0, 0.5, 1.0, 0.25] {
        processor.set_parameter("gain", value);
        // The ramp from the previous value, then the value itself.
        processor.process(&[vec![1.0; 256]]);
        let output = processor.process(&[vec![1.0; 256]]);
        assert!(output[0].iter().all(|sample| *sample == value as f32));
    }
}

#[test]
fn repeats_the_same_processing() {
    let mut processor = gain(0.5);
    let first = processor.process(&[sine(512)]);
    for _ in 0..10 {
        assert_eq!(processor.process(&[sine(512)]), first);
    }
}

#[test]
fn resets_and_prepares_again() {
    let mut processor = gain(0.5);
    processor.process(&[sine(512)]);
    assert_eq!(processor.reset(), Status::Ok);
    assert_eq!(processor.process(&[vec![1.0]])[0], [0.5]);
    assert_eq!(processor.prepare(96_000.0, 64), Status::Ok);
    assert_eq!(processor.process(&[vec![1.0; 100]])[0], vec![0.5; 100]);
}

#[test]
fn processes_empty_blocks() {
    let mut processor = gain(0.5);
    assert_eq!(processor.process_silence(0), Status::Ok);
    assert!(processor.process(&[Vec::<f32>::new()])[0].is_empty());
}

#[test]
fn instances_are_independent() {
    let mut quiet = gain(0.1);
    let mut loud = gain(1.0);
    let input = sine(256);
    let soft = quiet.process(std::slice::from_ref(&input));
    assert_eq!(loud.process(std::slice::from_ref(&input))[0], input);
    assert_eq!(quiet.process(std::slice::from_ref(&input)), soft);
}

#[test]
fn starts_at_the_current_gain_after_prepare() {
    // No glide up from silence on the first block.
    let output = gain(0.8).process(&[vec![1.0; 4]]);
    assert_eq!(output[0], [0.8; 4]);
}
