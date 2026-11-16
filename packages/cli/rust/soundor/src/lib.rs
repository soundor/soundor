//! Soundor plugins in Rust: their audio processing, and their controller.
//!
//! A Soundor plugin's UI is TypeScript and React; the rest of it is Rust, in
//! the project's `native/` crate:
//!
//! - its [`Processor`], on the audio thread. Soundor's runtimes run the same
//!   one: the JUCE runtime calls it through a C ABI on the host's audio
//!   thread, and the Web runtime runs it compiled to WebAssembly in an
//!   AudioWorklet;
//! - its required [`Controller`], on the control thread beside the UI: the
//!   Rust behind `soundor:native`'s methods, with the plugin's parameters,
//!   persistent state, History and presets, and async tasks that publish
//!   the processor's resources. The JUCE runtime runs it natively; the web runtime through WASM.
//!
//! `soundor.config.ts` stays the one source of the plugin's contract: its
//! parameters arrive here as the typed [`Parameters`], its audio layouts as
//! the [`ActiveLayout`] the host negotiated, its native streams as
//! [`Streams`], the persistent state it reads (`audio: true`) as the
//! [`StateSnapshot`], its audio resources as [`Resources`], and its native
//! methods as the [`NativeMethods`] trait a controller implements. Nothing
//! about the plugin is declared again in Rust.
//!
//! ```ignore
//! use soundor::prelude::*;
//!
//! #[derive(Default)]
//! pub struct PluginProcessor;
//!
//! impl Processor for PluginProcessor {
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
//! #[derive(Default)]
//! pub struct LocalStore {
//!     counter: i32,
//! }
//!
//! pub struct PluginController;
//!
//! impl Controller for PluginController {
//!     type Local = LocalStore;
//!     type Shared = ();
//! }
//!
//! // soundor.config.ts: native: { methods: { increment: { returns: 'int32' } } }
//! impl NativeMethods for PluginController {
//!     fn increment(ctx: &mut TaskContext<Self>) -> i32 {
//!         ctx.store.local.counter += 1;
//!         ctx.store.local.counter
//!     }
//! }
//!
//! soundor::export!(PluginProcessor, PluginController);
//! ```
//!
//! This crate is copied into each project by `soundor gen`, with
//! `src/plugin.rs` generated from the project's config: depend on it by path
//! (`soundor = { path = "../.soundor/generated/rust/soundor" }`), never from
//! crates.io.

#![warn(missing_docs)]
#![deny(unsafe_op_in_unsafe_fn)]

mod audio;
#[cfg(doctest)]
mod compile_tests;
mod context;
mod controller;
#[doc(hidden)]
pub mod controller_ffi;
mod controller_testing;
mod error;
mod executor;
#[doc(hidden)]
pub mod ffi;
#[doc(hidden)]
pub mod host;
mod instance;
#[doc(hidden)]
pub mod json;
mod layout;
#[doc(hidden)]
pub mod wasm_controller;
// Generated from soundor.config.ts, as generated.
#[rustfmt::skip]
mod plugin;
mod processor;
mod resources;
mod schedule;
mod state;
mod streams;
pub mod testing;
mod transport;
pub mod wasm;
#[doc(hidden)]
pub mod wire;

pub use audio::{Audio, Bus, BusMut, Channels as ChannelIter, ChannelsMut};
pub use context::{ActiveLayout, PrepareContext, ProcessContext};
#[doc(hidden)]
pub use controller::ParameterValue;
pub use controller::{
    AsyncStore, AsyncTaskContext, Controller, HistoryAccess, Parameter, PluginInfo, PresetsAccess,
    ProcessorHandle, ReadOnlyParameter, SharedStore, StateField, TaskContext, TaskStore,
};
pub use error::Error;
#[cfg(not(target_arch = "wasm32"))]
pub use executor::{Unblock, unblock};
pub use plugin::{
    NativeMethods, ParameterAccess, Parameters, Publish, ResourcePublishers, Resources, STATE_SIZE,
    StateAccess, StateSnapshot, Streams, choices, types,
};
pub use processor::Processor;
pub use resources::{Resource, ResourceElement, ResourcePublisher};
pub use schedule::{Schedule, ScheduleError};
pub use state::StateArray;
pub use streams::{BufferStream, StreamElement, ValueStream};
pub use transport::Transport;

/// The plugin's identity, from `soundor.config.ts`.
pub mod config {
    pub use crate::layout::Layout;
    pub use crate::plugin::{
        DEFAULT_INPUTS, DEFAULT_OUTPUTS, LAYOUTS, PARAMETER_IDS, PLUGIN_ID, PLUGIN_NAME, PRESET_IDS,
    };
}

/// What a plugin's module usually imports: `use soundor::prelude::*;`.
pub mod prelude {
    pub use crate::{
        ActiveLayout, AsyncTaskContext, Audio, Controller, Error, NativeMethods, Parameters,
        PrepareContext, ProcessContext, Processor, Publish, ResourcePublishers, Resources,
        ScheduleError, StateArray, StateSnapshot, Streams, TaskContext, Transport, choices, types,
    };
}

/// The version of the ABI between the runtimes and the processor. A runtime
/// refuses a processor built with another.
pub const ABI_VERSION: u32 = 2;

pub use host::CONTROLLER_ABI_VERSION;
