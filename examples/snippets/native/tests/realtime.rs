//! The processor on the audio thread: it makes no allocator call while it
//! processes (one can take a lock, and miss the audio's deadline). The
//! test binary counts them with Soundor's allocator.

use soundor::testing::{CountingAllocator, TestProcessor};
use soundor_snippets::Processor;

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
        let mut processor = TestProcessor::<Processor>::new()
            .block_size(block_size)
            .build();
        processor.set_parameter("gain", 0.25);
        processor.process(&[sine(12_000), sine(12_000)]);
        processor.set_parameter("bypass", 1.0);
        processor.process(&[sine(12_000), sine(12_000)]);
        assert_eq!(processor.allocations(), 0, "block size {block_size}");
    }
}
