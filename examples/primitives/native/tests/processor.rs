//! The processor, tested in plain Rust: `cargo test --manifest-path native/Cargo.toml`.

use soundor_primitives::Processor;
use soundor::testing::TestProcessor;

#[test]
fn applies_the_gain() {
    let mut processor = TestProcessor::<Processor>::new()
        .sample_rate(48_000.0)
        .block_size(256)
        .parameter("gain", 0.5)
        .build();
    let output = processor.process(&[vec![1.0, 0.5, -1.0]]);
    assert_eq!(output[0], [0.5, 0.25, -0.5]);
}
