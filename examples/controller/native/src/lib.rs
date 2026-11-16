//! The plugin's Rust entry point.
mod controller;
mod processor;
pub use controller::PluginController;
#[cfg(not(target_arch = "wasm32"))]
pub use controller::within;
pub use processor::{PluginProcessor, TABLE_SIZE, render};
soundor::export!(PluginProcessor, PluginController);
