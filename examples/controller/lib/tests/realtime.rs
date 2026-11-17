//! The processor runs on the audio thread, where an allocator call can take
//! a lock and miss the audio's deadline: it must make none while processing.

use soundor::testing::{CountingAllocator, TestProcessor};
use soundor_controller::PluginProcessor;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn processing_does_not_allocate() {
    for block_size in [1, 64, 512, 4096] {
        let mut processor = TestProcessor::<PluginProcessor>::new()
            .block_size(block_size)
            .build();
        let input: Vec<f32> = (0..24_000)
            .map(|frame| (frame as f32 * 0.01).sin())
            .collect();
        processor.process(&[input.clone(), input]);
        assert_eq!(processor.allocations(), 0, "block size {block_size}");
    }
}
