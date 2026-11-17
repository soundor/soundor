//! The processor on the audio thread: it makes no allocator call while it
//! processes (one can take a lock, and miss the audio's deadline). The
//! test binary counts them with Soundor's allocator.

use soundor::testing::{CountingAllocator, TestProcessor};
use soundor_analyzer::PluginProcessor;

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
        // Long enough for its FFT to run, and publish, many times.
        processor.process(&[sine(48_000), sine(48_000)]);
        assert_eq!(processor.allocations(), 0, "block size {block_size}");
    }
}
