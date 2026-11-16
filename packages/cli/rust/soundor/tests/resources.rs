//! The config's audio resources (`native.resources`): published from
//! `prepare`, read by `process` from the next block, replaced and freed
//! outside the audio thread.

use soundor::prelude::*;
use soundor::testing::{CountingAllocator, TestProcessor};

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// Publishes a wavetable of `size` elements, each its length, in `prepare`
/// (as an instrument computes one for the sample rate), and records what
/// each block read.
#[derive(Default)]
struct Wavetable {
    size: usize,
    publish_impulse: bool,
    // Preallocated in `prepare`: `process` never allocates.
    seen: Vec<Option<usize>>,
    whole: bool,
    impulse: Option<usize>,
}

impl AudioProcessor for Wavetable {
    fn prepare(&mut self, ctx: &PrepareContext) {
        // Allocating here is fine: prepare is outside the audio thread.
        let table: Vec<f32> = vec![self.size as f32; self.size];
        ctx.resources.wavetable.publish(table);
        if self.publish_impulse {
            ctx.resources.impulse.publish(vec![0.5f64; 3]);
        }
        self.seen = Vec::with_capacity(256);
        self.whole = true;
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let table = ctx.resources.wavetable.get();
        if let Some(table) = table {
            // Every element of one publication is its length: a mix would
            // be torn.
            self.whole &= table.iter().all(|&value| value == table.len() as f32);
        }
        if self.seen.len() < self.seen.capacity() {
            self.seen.push(table.map(<[f32]>::len));
        }
        self.impulse = ctx.resources.impulse.get().map(<[f64]>::len);
    }
}

soundor::export!(Wavetable);

fn processor(size: usize) -> TestProcessor<Wavetable> {
    TestProcessor::new()
        .processor(Wavetable {
            size,
            ..Wavetable::default()
        })
        .block_size(64)
        .build()
}

#[test]
fn prepare_publishes_and_the_next_block_reads_it() {
    let mut processor = processor(2048);
    processor.process_silence(64);
    assert_eq!(processor.processor().seen, [Some(2048)]);
    // A resource never published is None.
    assert_eq!(processor.processor().impulse, None);
    assert!(processor.processor().whole);
}

#[test]
fn any_length_from_empty_to_large() {
    for size in [0, 1, 7, 48_000, 1 << 21] {
        let mut processor = processor(size);
        processor.process_silence(64);
        assert_eq!(processor.processor().seen, [Some(size)]);
        assert!(processor.processor().whole);
    }
}

#[test]
fn preparing_again_replaces_it_and_frees_the_old_one_outside_the_audio_thread() {
    let mut processor = processor(16);
    processor.process_silence(64);
    for size in [32, 0, 4096, 8] {
        processor.processor_mut().size = size;
        processor.processor_mut().publish_impulse = true;
        assert_eq!(
            processor.prepare(48_000.0, 64),
            soundor::testing::Status::Ok
        );
        processor.process_silence(64);
        processor.process_silence(64);
        assert_eq!(processor.processor().seen.last(), Some(&Some(size)));
        assert_eq!(processor.processor().impulse, Some(3));
        assert!(processor.processor().whole);
    }
    // Every block, taking new publications and retiring old ones, neither
    // allocated nor freed.
    assert_eq!(processor.allocations(), 0);
}

#[test]
fn instances_are_independent() {
    let mut small = processor(4);
    let mut large = processor(400);
    small.process_silence(64);
    large.process_silence(64);
    assert_eq!(small.processor().seen, [Some(4)]);
    assert_eq!(large.processor().seen, [Some(400)]);
}

#[test]
fn destroying_a_processor_frees_what_it_holds() {
    for _ in 0..100 {
        let mut processor = processor(10_000);
        processor.process_silence(64);
        processor.processor_mut().size = 20_000;
        processor.prepare(48_000.0, 64);
        // Published, not yet read: freed with the processor too.
        drop(processor);
    }
}
