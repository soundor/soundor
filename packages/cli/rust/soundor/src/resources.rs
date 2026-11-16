//! The config's audio resources (`native.resources`): immutable,
//! dynamically sized data the processing reads, such as a wavetable, an
//! impulse response or a lookup table, prepared outside the audio thread.
//!
//! A resource is published whole, then never changed. The audio thread takes
//! the latest publication at the start of a block and reads it until the
//! next, and a replaced one is freed off the audio thread. Unlike state,
//! resources are not saved with the plugin, not part of presets or History,
//! and have no fixed size.
//!
//! The handoff is single-reader RCU with deferred reclamation, three
//! pointers per resource:
//!
//! - `pending`, the latest publication the reader has not taken. Publishing
//!   swaps the new value in; whatever it swaps out the reader never saw, so
//!   the publisher frees it.
//! - `current`, the one the reader reads, which only the reader touches.
//! - `retired`, the one the reader read before `current`. Only the reader
//!   fills it, only when it is empty; a publisher (or [`collect`]) empties it
//!   and frees what it held, outside the audio thread.
//!
//! The reader takes `pending` at a block's start only when `retired` is
//! empty, so the audio thread never frees: until then it keeps reading
//! `current`, which stays valid. Publishers may run on any threads at once,
//! and never wait for the reader, nor the reader for them.
//!
//! [`collect`]: ResourceSlot::collect

use std::marker::PhantomData;
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};

/// One resource's handoff: the publications of any number of threads, and
/// the reading of one (the audio thread).
pub(crate) struct ResourceSlot<T: Send + Sync> {
    pending: AtomicPtr<T>,
    retired: AtomicPtr<T>,
    // The reader's; see `acquire`.
    current: AtomicPtr<T>,
    _owns: PhantomData<Box<T>>,
}

// SAFETY: values move between threads whole (`T: Send`) and are read from
// the reader while others may hold the slot (`T: Sync`); every pointer is
// handed over through atomics with acquire/release ordering.
unsafe impl<T: Send + Sync> Sync for ResourceSlot<T> {}

impl<T: Send + Sync> Default for ResourceSlot<T> {
    fn default() -> Self {
        Self {
            pending: AtomicPtr::new(ptr::null_mut()),
            retired: AtomicPtr::new(ptr::null_mut()),
            current: AtomicPtr::new(ptr::null_mut()),
            _owns: PhantomData,
        }
    }
}

/// Frees what `pointer` owns, if anything.
///
/// # Safety
///
/// `pointer` is null or came from `Box::into_raw`, and nothing else owns it.
unsafe fn free<T>(pointer: *mut T) {
    if !pointer.is_null() {
        // SAFETY: as the caller promises.
        drop(unsafe { Box::from_raw(pointer) });
    }
}

// Unused by a plugin without resources.
#[allow(dead_code)]
impl<T: Send + Sync> ResourceSlot<T> {
    /// Outside the audio thread: makes `value` the latest publication,
    /// replacing one the reader has not taken yet, and frees what the reader
    /// is done with. Latest publication wins.
    pub fn publish(&self, value: T) {
        let next = Box::into_raw(Box::new(value));
        // AcqRel: the value is visible to whoever takes it, and a replaced
        // publication's contents to this thread, which frees it.
        let replaced = self.pending.swap(next, Ordering::AcqRel);
        // SAFETY: the reader takes `pending` only by swapping it out, so a
        // publication swapped out here was never taken: it is ours.
        unsafe { free(replaced) };
        self.collect();
    }

    #[cfg(target_arch = "wasm32")]
    pub fn take_pending(&self) -> Option<T> {
        let pointer = self.pending.swap(ptr::null_mut(), Ordering::AcqRel);
        if pointer.is_null() {
            None
        } else {
            // SAFETY: the swap transfers the pending allocation to us.
            Some(*unsafe { Box::from_raw(pointer) })
        }
    }

    /// Outside the audio thread: frees the value the reader last replaced,
    /// if it has not been freed yet.
    pub fn collect(&self) {
        // Acquire: the reader's reads of it happened before it retired it.
        let retired = self.retired.swap(ptr::null_mut(), Ordering::AcqRel);
        // SAFETY: the reader retires a value once it reads it no more, and
        // only this swap takes it back.
        unsafe { free(retired) };
    }

    /// On the audio thread, at a block's start: takes the latest
    /// publication, if there is one and the value it replaces can be retired.
    /// Never allocates, frees, locks or waits.
    ///
    /// # Safety
    ///
    /// One thread at a time calls `acquire` and [`get`](Self::get), and no
    /// reference [`get`] returned outlives the next `acquire`.
    pub unsafe fn acquire(&self) {
        if self.pending.load(Ordering::Relaxed).is_null()
            || !self.retired.load(Ordering::Acquire).is_null()
        {
            return;
        }
        let next = self.pending.swap(ptr::null_mut(), Ordering::AcqRel);
        if next.is_null() {
            return;
        }
        let previous = self.current.swap(next, Ordering::Relaxed);
        // Release: the reads of `previous` happen before a publisher frees
        // it. `retired` was empty: only the reader fills it.
        self.retired.store(previous, Ordering::Release);
    }

    /// The value the reader holds: the publication it last took.
    ///
    /// # Safety
    ///
    /// As [`acquire`](Self::acquire): on the reader's thread, and the
    /// reference lives no longer than the next `acquire`.
    pub unsafe fn get(&self) -> Option<&T> {
        // SAFETY: `current` is the reader's; it is freed only once retired,
        // by a later `acquire` (or when the slot is dropped).
        unsafe { self.current.load(Ordering::Relaxed).as_ref() }
    }
}

impl<T: Send + Sync> Drop for ResourceSlot<T> {
    fn drop(&mut self) {
        // No reader and no publisher is left: everything is ours to free.
        for pointer in [
            self.pending.get_mut(),
            self.retired.get_mut(),
            self.current.get_mut(),
        ] {
            // SAFETY: each pointer is null or a box no one else owns.
            unsafe { free(std::mem::replace(pointer, ptr::null_mut())) };
        }
    }
}

/// A number type a resource holds.
pub trait ResourceElement: Copy + Send + Sync + 'static + private::Sealed {}

mod private {
    pub trait Sealed {}
}

macro_rules! elements {
    ($($type:ty),*) => {$(
        impl private::Sealed for $type {}
        impl ResourceElement for $type {}
    )*};
}
elements!(f32, f64, i8, u8, i16, u16, i32, u32, i64, u64);

/// Where `prepare` publishes a resource: [`publish`](Self::publish) makes
/// its value the one the processing reads from its next block.
pub struct ResourcePublisher<'a, T: ResourceElement> {
    slot: &'a ResourceSlot<Box<[T]>>,
}

impl<'a, T: ResourceElement> ResourcePublisher<'a, T> {
    #[allow(dead_code)]
    pub(crate) fn new(slot: &'a ResourceSlot<Box<[T]>>) -> Self {
        Self { slot }
    }

    /// Publishes `values`, of any length, as the resource: moved, not
    /// copied. Replaces any publication not yet read; the one it replaces
    /// for the processing is freed here or by a later publication, never on
    /// the audio thread.
    pub fn publish(&self, values: impl Into<Box<[T]>>) {
        self.slot.publish(values.into());
    }
}

/// A resource as the processing reads it during a block.
pub struct Resource<'a, T: ResourceElement> {
    value: Option<&'a [T]>,
}

impl<'a, T: ResourceElement> Resource<'a, T> {
    /// # Safety
    ///
    /// The block holds `slot`'s reader side, acquired at its start, for `'a`.
    #[allow(dead_code)]
    pub(crate) unsafe fn new(slot: &'a ResourceSlot<Box<[T]>>) -> Self {
        // SAFETY: as the caller promises.
        let value = unsafe { slot.get() }.map(|values| &**values);
        Self { value }
    }

    /// The latest value published before this block, the same throughout
    /// the block: `None` until one is published.
    pub fn get(&self) -> Option<&'a [T]> {
        self.value
    }
}

#[cfg(test)]
mod tests {
    use super::ResourceSlot;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::thread;

    /// Counts how many values are alive.
    struct Counted {
        values: Vec<u64>,
        live: Arc<AtomicUsize>,
    }

    impl Counted {
        fn new(length: usize, value: u64, live: &Arc<AtomicUsize>) -> Self {
            live.fetch_add(1, Ordering::SeqCst);
            Self {
                values: vec![value; length],
                live: live.clone(),
            }
        }
    }

    impl Drop for Counted {
        fn drop(&mut self) {
            self.live.fetch_sub(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn the_reader_sees_the_latest_publication_and_old_ones_are_freed_off_its_thread() {
        let live = Arc::new(AtomicUsize::new(0));
        let slot = ResourceSlot::default();
        // SAFETY: this thread is the reader throughout.
        unsafe {
            slot.acquire();
            assert!(slot.get().is_none());
            slot.publish(Counted::new(4, 1, &live));
            slot.publish(Counted::new(4, 2, &live));
            // The first, never read, is freed by the second publication.
            assert_eq!(live.load(Ordering::SeqCst), 1);
            assert!(slot.get().is_none());
            slot.acquire();
            assert_eq!(slot.get().unwrap().values, [2; 4]);
            slot.publish(Counted::new(0, 3, &live));
            slot.acquire();
            assert!(slot.get().unwrap().values.is_empty());
            // The replaced one waits, retired, for a publisher.
            assert_eq!(live.load(Ordering::SeqCst), 2);
            slot.collect();
            assert_eq!(live.load(Ordering::SeqCst), 1);
            // While one is retired the reader keeps its current value.
            slot.publish(Counted::new(1, 4, &live));
            slot.acquire();
            slot.publish(Counted::new(1, 5, &live));
            slot.acquire();
            assert_eq!(slot.get().unwrap().values, [5]);
        }
        drop(slot);
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_retired_value_delays_the_next_until_collected() {
        let slot = ResourceSlot::default();
        // SAFETY: this thread is the reader.
        unsafe {
            slot.publish(1u32);
            slot.acquire();
            slot.retired
                .store(Box::into_raw(Box::new(0u32)), Ordering::Release);
            slot.pending
                .store(Box::into_raw(Box::new(2u32)), Ordering::Release);
            slot.acquire();
            assert_eq!(slot.get(), Some(&1));
            slot.collect();
            slot.acquire();
            assert_eq!(slot.get(), Some(&2));
        }
    }

    #[test]
    fn concurrent_publishers_and_a_reader_never_see_a_torn_or_freed_value() {
        let live = Arc::new(AtomicUsize::new(0));
        let slot = Arc::new(ResourceSlot::<Counted>::default());
        let done = Arc::new(AtomicBool::new(false));
        let reader = {
            let (slot, done) = (slot.clone(), done.clone());
            thread::spawn(move || {
                let (mut blocks, mut torn) = (0usize, 0usize);
                while !done.load(Ordering::Acquire) {
                    // SAFETY: this thread is the only reader; the reference
                    // ends before the next acquire.
                    unsafe {
                        slot.acquire();
                        if let Some(value) = slot.get() {
                            let expected = value.values.len() as u64;
                            // Read it all, slowly, as a block would.
                            if value.values.iter().any(|&element| element != expected) {
                                torn += 1;
                            }
                        }
                    }
                    blocks += 1;
                }
                (blocks, torn)
            })
        };
        let publishers: Vec<_> = (0..4)
            .map(|publisher| {
                let (slot, live) = (slot.clone(), live.clone());
                thread::spawn(move || {
                    for round in 0..500 {
                        // Lengths from empty to large: each element is the length.
                        let length = (round * 37 + publisher * 1009) % 20_000;
                        slot.publish(Counted::new(length, length as u64, &live));
                    }
                })
            })
            .collect();
        for publisher in publishers {
            publisher.join().unwrap();
        }
        done.store(true, Ordering::Release);
        let (blocks, torn) = reader.join().unwrap();
        assert!(blocks > 0);
        assert_eq!(torn, 0);
        // At most the pending, current and retired ones are alive.
        assert!(live.load(Ordering::SeqCst) <= 3);
        drop(slot);
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    /// What the audio thread pays per block to take and read a resource,
    /// and what replacing one costs:
    /// `cargo test --release --lib resources -- --ignored --nocapture`.
    #[test]
    #[ignore = "a benchmark"]
    fn benchmark_acquisition_and_replacement() {
        use std::hint::black_box;
        use std::time::Instant;

        const BLOCKS: u32 = 10_000_000;
        let slot = ResourceSlot::<Box<[f32]>>::default();
        slot.publish(vec![0.25f32; 4096].into());
        let started = Instant::now();
        for _ in 0..BLOCKS {
            // SAFETY: this thread is the reader.
            unsafe {
                slot.acquire();
                black_box(slot.get().map(|table| table.len()));
            }
        }
        let unchanged = started.elapsed().as_secs_f64() * 1e9 / f64::from(BLOCKS);

        const REPLACEMENTS: u32 = 100_000;
        let tables: Vec<Box<[f32]>> = (0..REPLACEMENTS)
            .map(|_| vec![0.5f32; 4096].into())
            .collect();
        let started = Instant::now();
        for table in tables {
            slot.publish(table);
            // SAFETY: as above.
            unsafe {
                slot.acquire();
                black_box(slot.get().map(|table| table.len()));
            }
        }
        let replaced = started.elapsed().as_secs_f64() * 1e9 / f64::from(REPLACEMENTS);
        println!(
            "acquire and get, nothing published: {unchanged:.2} ns; \
             publish a 4096-element table (freeing the one retired), then acquire and get it: {replaced:.1} ns"
        );
    }
}
