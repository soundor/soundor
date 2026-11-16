//! The processor on the audio thread: it makes no allocator call while it
//! processes (one can take a lock, and miss the audio's deadline). The
//! test binary counts them with Soundor's allocator.

use orbit::PluginProcessor;
use soundor::testing::{CountingAllocator, TestProcessor};

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn sine(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|frame| (frame as f32 * 0.013).sin() * 0.5)
        .collect()
}

#[test]
fn processing_does_not_allocate() {
    for block_size in [1, 64, 512, 4096] {
        let mut processor = TestProcessor::<PluginProcessor>::new()
            .block_size(block_size)
            .build();
        processor.transport_mut().tempo = Some(132.0);
        // Every path: free and synced times, drift, repeats, the filter,
        // Hold, bypass, and taps moving while they play.
        for (parameter, value) in [
            ("sync", 0.0),
            ("motion", 1.0),
            ("feedback", 0.9),
            ("tone", 0.2),
            ("time2", 0.25),
            ("sync", 1.0),
            ("hold", 1.0),
            ("hold", 0.0),
            ("bypass", 1.0),
            ("bypass", 0.0),
        ] {
            processor.set_parameter(parameter, value);
            processor.process(&[sine(6_000), sine(6_000)]);
        }
        assert_eq!(processor.allocations(), 0, "block size {block_size}");
    }
}
