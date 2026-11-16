//! The config's native streams (`native.streams`): the latest value the
//! processing publishes, which every open editor reads once a frame.

use std::marker::PhantomData;

/// Where a block's stream values go: the runtime's streams, or a test's.
/// Implementations are realtime-safe: they never allocate, block or lock.
pub(crate) trait StreamSink {
    /// Publishes stream `index`'s new value.
    fn publish(&self, index: u32, value: f64);
    /// Stream `index`'s buffer to write, and how many elements it holds.
    fn buffer(&self, index: u32) -> (*mut u8, usize);
    /// Publishes the first `length` elements of stream `index`'s buffer.
    fn commit(&self, index: u32, length: usize);
}

/// A sink that drops everything: a plugin without streams, or a runtime
/// that passed none.
pub(crate) struct NoStreams;

impl StreamSink for NoStreams {
    fn publish(&self, _: u32, _: f64) {}
    fn buffer(&self, _: u32) -> (*mut u8, usize) {
        (std::ptr::null_mut(), 0)
    }
    fn commit(&self, _: u32, _: usize) {}
}

/// A number type a stream carries.
pub trait StreamElement: Copy + Default + private::Sealed + 'static {
    #[doc(hidden)]
    fn to_f64(self) -> f64;
}

mod private {
    pub trait Sealed {}
}

macro_rules! elements {
    ($($type:ty),*) => {$(
        impl private::Sealed for $type {}
        impl StreamElement for $type {
            fn to_f64(self) -> f64 {
                f64::from(self)
            }
        }
    )*};
}
elements!(f32, f64, i8, u8, i16, u16, i32, u32);

// Beyond 2^53, a 64-bit number stream's value is rounded on its way.
macro_rules! wide_elements {
    ($($type:ty),*) => {$(
        impl private::Sealed for $type {}
        impl StreamElement for $type {
            fn to_f64(self) -> f64 {
                self as f64
            }
        }
    )*};
}
wide_elements!(i64, u64);

/// A stream of one number: [`publish`](Self::publish) replaces its value.
pub struct ValueStream<'a, T: StreamElement> {
    sink: &'a dyn StreamSink,
    index: u32,
    _type: PhantomData<T>,
}

impl<'a, T: StreamElement> ValueStream<'a, T> {
    // Unused by a plugin without number streams.
    #[allow(dead_code)]
    pub(crate) fn new(sink: &'a dyn StreamSink, index: u32) -> Self {
        Self {
            sink,
            index,
            _type: PhantomData,
        }
    }

    /// Publishes `value`; editors read the newest. Realtime-safe.
    pub fn publish(&mut self, value: T) {
        self.sink.publish(self.index, value.to_f64());
    }
}

/// A stream of up to `maxLength` numbers, published whole: editors never
/// see a buffer half written.
pub struct BufferStream<'a, T: StreamElement> {
    sink: &'a dyn StreamSink,
    index: u32,
    _type: PhantomData<T>,
}

impl<'a, T: StreamElement> BufferStream<'a, T> {
    // Unused by a plugin without buffer streams.
    #[allow(dead_code)]
    pub(crate) fn new(sink: &'a dyn StreamSink, index: u32) -> Self {
        Self {
            sink,
            index,
            _type: PhantomData,
        }
    }

    /// The stream's own storage, `maxLength` elements, to write the next
    /// value into without a copy; publish it with [`commit`](Self::commit).
    /// Empty when the runtime gave the processing no streams.
    pub fn buffer_mut(&mut self) -> &mut [T] {
        let (pointer, length) = self.sink.buffer(self.index);
        if pointer.is_null() || length == 0 {
            return &mut [];
        }
        // SAFETY: the sink hands out `length` elements of this stream's
        // declared type, properly aligned, which only this handle writes
        // until it commits; `&mut self` keeps it the only borrow.
        unsafe { std::slice::from_raw_parts_mut(pointer.cast::<T>(), length) }
    }

    /// Publishes the first `length` elements of [`buffer_mut`](Self::buffer_mut)
    /// (at most `maxLength`). Realtime-safe.
    pub fn commit(&mut self, length: usize) {
        self.sink.commit(self.index, length);
    }

    /// Copies `values` (at most `maxLength` of them) into the stream and
    /// publishes them.
    pub fn publish(&mut self, values: &[T]) {
        let buffer = self.buffer_mut();
        let length = values.len().min(buffer.len());
        buffer[..length].copy_from_slice(&values[..length]);
        self.commit(length);
    }
}
