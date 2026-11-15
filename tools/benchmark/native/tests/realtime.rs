//! The processor on the audio thread: it makes no allocator call while it
//! processes (one can take a lock, and miss the audio's deadline). The
//! test binary counts them with Soundor's allocator.

use soundor::testing::{CountingAllocator, TestProcessor};
use soundor_benchmark_processor::Processor;

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
        for gain in [0.5, 0.0, 1.0] {
            processor.set_parameter("gain", gain);
            processor.process(&[sine(12_000), sine(12_000)]);
        }
        assert_eq!(processor.allocations(), 0, "block size {block_size}");
    }
}
