//! The snippets' gain, tested through Soundor's testing harness.
//! `cargo test --manifest-path lib/Cargo.toml` (after `soundor gen`).

use soundor::testing::TestProcessor;
use soundor_snippets::PluginProcessor;

fn processor(gain: f64, bypass: bool) -> TestProcessor<PluginProcessor> {
    TestProcessor::<PluginProcessor>::new()
        .parameter("gain", gain)
        .parameter("bypass", if bypass { 1.0 } else { 0.0 })
        .build()
}

#[test]
fn applies_the_gain() {
    let output = processor(0.5, false).process(&[vec![1.0, -0.5], vec![0.25, 0.0]]);
    assert_eq!(output, [vec![0.5, -0.25], vec![0.125, 0.0]]);
}

#[test]
fn bypass_passes_the_input() {
    let input = vec![1.0, -0.5, 0.25];
    let output = processor(0.0, true).process(std::slice::from_ref(&input));
    assert_eq!(output[0], input);
}

#[test]
fn ramps_into_bypass_over_one_block() {
    let mut gain = TestProcessor::<PluginProcessor>::new()
        .block_size(4)
        .parameter("gain", 0.0)
        .build();
    gain.set_parameter("bypass", 1.0);
    assert_eq!(gain.process(&[vec![1.0; 4]])[0], [0.0, 0.25, 0.5, 0.75]);
    assert_eq!(gain.process(&[vec![1.0; 4]])[0], [1.0; 4]);
}
