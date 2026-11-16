//! The processor, tested in plain Rust: `cargo test --manifest-path lib/Cargo.toml`.

use soundor::testing::TestProcessor;
use soundor::types::Shape;
use soundor_controller::{PluginProcessor, TABLE_SIZE, render};

#[test]
fn without_depth_it_passes_its_input_through() {
    let mut processor = TestProcessor::<PluginProcessor>::new()
        .parameter("depth", 0.0)
        .build();
    let output = processor.process(&[vec![1.0, 0.5, -1.0]]);
    assert_eq!(output[0], [1.0, 0.5, -1.0]);
}

#[test]
fn it_modulates_with_the_sine_prepare_published() {
    let mut processor = TestProcessor::<PluginProcessor>::new()
        .sample_rate(48_000.0)
        .parameter("rate", 1_000.0)
        .build();
    let input = vec![1.0; 48];
    let output = processor.process(&[input.clone(), input]);
    // One period of the modulator over 48 frames at 1 kHz.
    let expected = render(Shape::Sine, TABLE_SIZE);
    assert_eq!(output[0][0], expected[0]);
    assert!((output[0][12] - 1.0).abs() < 1e-3);
    assert!((output[0][36] + 1.0).abs() < 1e-3);
    assert_eq!(output[0], output[1]);
}
