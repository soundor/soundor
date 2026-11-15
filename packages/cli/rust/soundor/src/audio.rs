//! A block's audio: the active layout's buses, as slices of samples.

use std::marker::PhantomData;

/// One block's audio, by bus, as the active layout arranges it.
///
/// The main bus is processed in place: [`channels`](Self::channels) are the
/// main output's channels, and each starts the block holding the main input
/// channel of the same index, or silence where the input has fewer channels.
/// Write the block's output over it. The other output buses start silent.
///
/// [`input`](Self::input) reads input buses. Bus 0 is the main input: its
/// channels that are processed in place are the main output's channels, so
/// they hold what the output holds now. Read them before writing, or read
/// [`channel`](Self::channel).
///
/// Every channel holds [`frames`](Self::frames) samples, at most the
/// `max_frames` the processor was prepared with. A block may be empty.
pub struct Audio<'a> {
    frames: usize,
    inputs: &'a [*const f32],
    outputs: &'a [*mut f32],
    input_buses: &'a [usize],
    output_buses: &'a [usize],
    _samples: PhantomData<&'a mut [f32]>,
}

impl<'a> Audio<'a> {
    /// # Safety
    ///
    /// `inputs` and `outputs` hold one pointer per channel of each bus, in bus
    /// order, as `input_buses` and `output_buses` count them; each points to
    /// `frames` aligned `f32`s valid for `'a`. Output channels do not overlap
    /// each other or any input, except that main input channel `c` may be
    /// the very pointer of main output channel `c` (in place).
    pub(crate) unsafe fn new(
        frames: usize,
        inputs: &'a [*const f32],
        outputs: &'a [*mut f32],
        input_buses: &'a [usize],
        output_buses: &'a [usize],
    ) -> Self {
        debug_assert_eq!(inputs.len(), input_buses.iter().sum::<usize>());
        debug_assert_eq!(outputs.len(), output_buses.iter().sum::<usize>());
        Self {
            frames,
            inputs,
            outputs,
            input_buses,
            output_buses,
            _samples: PhantomData,
        }
    }

    /// How many samples each channel holds in this block.
    pub fn frames(&self) -> usize {
        self.frames
    }

    /// Whether the block holds no samples.
    pub fn is_empty(&self) -> bool {
        self.frames == 0
    }

    /// How many channels the main output bus has.
    pub fn channel_count(&self) -> usize {
        self.output_buses.first().copied().unwrap_or(0)
    }

    /// Main output channel `index`, as it is now.
    pub fn channel(&self, index: usize) -> Option<&[f32]> {
        let pointer = *self.outputs[..self.channel_count()].get(index)?;
        // SAFETY: valid for `frames` (see `new`), and no `&mut` to it can be
        // alive while `self` is borrowed.
        Some(unsafe { std::slice::from_raw_parts(pointer, self.frames) })
    }

    /// Main output channel `index`, to write.
    pub fn channel_mut(&mut self, index: usize) -> Option<&mut [f32]> {
        let pointer = *self.outputs[..self.channel_count()].get(index)?;
        // SAFETY: as in `channel`, and `&mut self` makes it the only borrow.
        Some(unsafe { std::slice::from_raw_parts_mut(pointer, self.frames) })
    }

    /// The main output's channels, to process in place: each starts holding
    /// the main input channel of its index (or silence).
    ///
    /// ```ignore
    /// let mut channels = ctx.audio.channels();
    /// if let (Some(left), Some(right)) = (channels.next(), channels.next()) {
    ///     // both at once
    /// }
    /// ```
    pub fn channels(&mut self) -> ChannelsMut<'_> {
        let count = self.channel_count();
        ChannelsMut::new(&self.outputs[..count], self.frames)
    }

    /// How many input buses the active layout has (disabled ones included,
    /// with no channels).
    pub fn input_bus_count(&self) -> usize {
        self.input_buses.len()
    }

    /// How many output buses the active layout has.
    pub fn output_bus_count(&self) -> usize {
        self.output_buses.len()
    }

    /// Input bus `bus`, in the order soundor.config declares input buses; 0
    /// is the main input. A disabled bus has no channels.
    pub fn input(&self, bus: usize) -> Option<Bus<'_>> {
        let range = bus_range(self.input_buses, bus)?;
        Some(Bus {
            pointers: &self.inputs[range],
            frames: self.frames,
            _samples: PhantomData,
        })
    }

    /// Output bus `bus`, in the order soundor.config declares output buses;
    /// 0 is the main output, the same channels as [`channels`](Self::channels).
    pub fn output(&mut self, bus: usize) -> Option<BusMut<'_>> {
        let range = bus_range(self.output_buses, bus)?;
        Some(BusMut {
            pointers: &self.outputs[range],
            frames: self.frames,
            _samples: PhantomData,
        })
    }
}

fn bus_range(buses: &[usize], bus: usize) -> Option<std::ops::Range<usize>> {
    let count = *buses.get(bus)?;
    let start = buses[..bus].iter().sum::<usize>();
    Some(start..start + count)
}

/// An input bus's channels, read-only.
#[derive(Clone, Copy)]
pub struct Bus<'a> {
    pointers: &'a [*const f32],
    frames: usize,
    _samples: PhantomData<&'a [f32]>,
}

impl<'a> Bus<'a> {
    /// How many channels the bus has.
    pub fn channel_count(&self) -> usize {
        self.pointers.len()
    }

    /// Channel `index`.
    pub fn channel(&self, index: usize) -> Option<&'a [f32]> {
        let pointer = *self.pointers.get(index)?;
        // SAFETY: valid for `frames`; the `Audio` this bus borrows is shared,
        // so no output can be written while it lives.
        Some(unsafe { std::slice::from_raw_parts(pointer, self.frames) })
    }

    /// Its channels, in order.
    pub fn channels(&self) -> Channels<'a> {
        Channels {
            pointers: self.pointers.iter(),
            frames: self.frames,
            _samples: PhantomData,
        }
    }
}

/// An output bus's channels, to write.
pub struct BusMut<'a> {
    pointers: &'a [*mut f32],
    frames: usize,
    _samples: PhantomData<&'a mut [f32]>,
}

impl BusMut<'_> {
    /// How many channels the bus has.
    pub fn channel_count(&self) -> usize {
        self.pointers.len()
    }

    /// Channel `index`, as it is now.
    pub fn channel(&self, index: usize) -> Option<&[f32]> {
        let pointer = *self.pointers.get(index)?;
        // SAFETY: valid for `frames`, borrowed through `&self`.
        Some(unsafe { std::slice::from_raw_parts(pointer, self.frames) })
    }

    /// Channel `index`, to write.
    pub fn channel_mut(&mut self, index: usize) -> Option<&mut [f32]> {
        let pointer = *self.pointers.get(index)?;
        // SAFETY: valid for `frames`; `&mut self` makes it the only borrow.
        Some(unsafe { std::slice::from_raw_parts_mut(pointer, self.frames) })
    }

    /// Its channels, in order, to write.
    pub fn channels(&mut self) -> ChannelsMut<'_> {
        ChannelsMut::new(self.pointers, self.frames)
    }
}

/// An iterator over channels, read-only.
pub struct Channels<'a> {
    pointers: std::slice::Iter<'a, *const f32>,
    frames: usize,
    _samples: PhantomData<&'a [f32]>,
}

impl<'a> Iterator for Channels<'a> {
    type Item = &'a [f32];

    fn next(&mut self) -> Option<Self::Item> {
        let pointer = *self.pointers.next()?;
        // SAFETY: as `Bus::channel`.
        Some(unsafe { std::slice::from_raw_parts(pointer, self.frames) })
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.pointers.size_hint()
    }
}

impl ExactSizeIterator for Channels<'_> {}

/// An iterator over channels to write. Each channel it yields is distinct
/// memory, so several can be held at once.
pub struct ChannelsMut<'a> {
    pointers: std::slice::Iter<'a, *mut f32>,
    frames: usize,
    _samples: PhantomData<&'a mut [f32]>,
}

impl<'a> ChannelsMut<'a> {
    fn new(pointers: &'a [*mut f32], frames: usize) -> Self {
        Self {
            pointers: pointers.iter(),
            frames,
            _samples: PhantomData,
        }
    }
}

impl<'a> Iterator for ChannelsMut<'a> {
    type Item = &'a mut [f32];

    fn next(&mut self) -> Option<Self::Item> {
        let pointer = *self.pointers.next()?;
        // SAFETY: output channels never overlap (see `Audio::new`), and each
        // pointer is yielded once while the iterator borrows the audio
        // mutably.
        Some(unsafe { std::slice::from_raw_parts_mut(pointer, self.frames) })
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.pointers.size_hint()
    }
}

impl ExactSizeIterator for ChannelsMut<'_> {}
