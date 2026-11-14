//! Audio processing for Soundor plugins.
//!
//! A Soundor plugin's UI is TypeScript and React; its audio processing is
//! Rust, in the project's `native/` crate. Soundor's runtimes run the same
//! processor: the JUCE runtime calls it through a C ABI on the host's audio
//! thread, and the Web runtime runs it compiled to WebAssembly in an
//! AudioWorklet.
//!
//! `soundor.config.ts` stays the one source of the plugin's contract: its
//! parameters arrive here as the typed [`Parameters`], its audio layouts as
//! the [`ActiveLayout`] the host negotiated, its native channels as
//! [`Channels`]. Nothing about the plugin is declared again in Rust.
//!
//! ```ignore
//! use soundor::prelude::*;
//!
//! #[derive(Default)]
//! pub struct Processor;
//!
//! impl AudioProcessor for Processor {
//!     fn prepare(&mut self, _ctx: &PrepareContext) {}
//!
//!     fn process(&mut self, ctx: &mut ProcessContext) {
//!         let gain = ctx.params.gain;
//!         for channel in ctx.audio.channels() {
//!             for sample in channel {
//!                 *sample *= gain;
//!             }
//!         }
//!     }
//! }
//!
//! soundor::export!(Processor);
//! ```
//!
//! This crate is copied into each project by `soundor gen`, with
//! `src/plugin.rs` generated from the project's config: depend on it by path
//! (`soundor = { path = "../.soundor/generated/rust/soundor" }`), never from
//! crates.io.

#![warn(missing_docs)]
#![deny(unsafe_op_in_unsafe_fn)]

mod audio;
mod channels;
mod context;
#[doc(hidden)]
pub mod ffi;
mod instance;
mod layout;
// Generated from soundor.config.ts, as generated.
#[rustfmt::skip]
mod plugin;
mod processor;
pub mod testing;
mod transport;

pub use audio::{Audio, Bus, BusMut, Channels as ChannelIter, ChannelsMut};
pub use channels::{BufferChannel, ChannelElement, ValueChannel};
pub use context::{ActiveLayout, PrepareContext, ProcessContext};
pub use plugin::{Channels, Parameters, Publish, choices};
pub use processor::AudioProcessor;
pub use transport::Transport;

/// The plugin's identity, from `soundor.config.ts`.
pub mod config {
    pub use crate::layout::Layout;
    pub use crate::plugin::{
        DEFAULT_INPUTS, DEFAULT_OUTPUTS, LAYOUTS, PARAMETER_IDS, PLUGIN_ID, PLUGIN_NAME,
    };
}

/// What a processor's module usually imports: `use soundor::prelude::*;`.
pub mod prelude {
    pub use crate::{
        ActiveLayout, Audio, AudioProcessor, Channels, Parameters, PrepareContext, ProcessContext,
        Publish, Transport, choices,
    };
}

/// The version of the ABI between the runtimes and the processor. A runtime
/// refuses a processor built with another.
pub const ABI_VERSION: u32 = 1;
