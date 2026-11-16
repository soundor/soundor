//! The persistent state the audio processing reads (`ctx.state`): the fields
//! soundor.config declares with `audio: true`, as one snapshot.
//!
//! The runtime keeps the snapshot up to date from the plugin's state, outside
//! the audio thread, and hands the processing the latest one at each block:
//! a block sees one snapshot from start to end, never one changing or partly
//! written, and every field of it as of one state change.
//!
//! Only the `audio: true` fields are in it: a processor cannot read the
//! UI's own state. With the SDK's fixture config, where `selectedTab` is
//! UI-only:
//!
//! ```
//! fn mode(state: &soundor::StateSnapshot) -> i32 {
//!     state.processing_mode
//! }
//! ```
//!
//! ```compile_fail,E0609
//! fn tab(state: &soundor::StateSnapshot) -> i32 {
//!     state.selected_tab // no field `selected_tab`
//! }
//! ```

use std::fmt;
use std::ops::Deref;

/// An array field, of up to `N` elements: its storage holds `N`, of which
/// the first [`len`](<[T]>::len) are the value. It reads as a slice.
#[repr(C)]
pub struct StateArray<T: Copy, const N: usize> {
    length: u32,
    items: [T; N],
}

impl<T: Copy, const N: usize> StateArray<T, N> {
    /// The most elements it holds (`maxLength`).
    pub const CAPACITY: usize = N;

    /// The value, as a slice.
    pub fn as_slice(&self) -> &[T] {
        &self.items[..(self.length as usize).min(N)]
    }

    /// Replaces the value with `values`: false, changing nothing, when there
    /// are more than `N`. For tests and defaults; the runtime writes the
    /// snapshot a processor reads.
    pub fn set(&mut self, values: &[T]) -> bool {
        if values.len() > N {
            return false;
        }
        self.items[..values.len()].copy_from_slice(values);
        self.length = values.len() as u32;
        true
    }

    /// Empties it.
    pub fn clear(&mut self) {
        self.length = 0;
    }
}

impl<T: Copy, const N: usize> Deref for StateArray<T, N> {
    type Target = [T];

    fn deref(&self) -> &[T] {
        self.as_slice()
    }
}

impl<T: Copy + PartialEq, const N: usize> PartialEq for StateArray<T, N> {
    fn eq(&self, other: &Self) -> bool {
        self.as_slice() == other.as_slice()
    }
}

impl<T: Copy + fmt::Debug, const N: usize> fmt::Debug for StateArray<T, N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_list().entries(self.as_slice()).finish()
    }
}
