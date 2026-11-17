//! The plugin's Rust entry point.
mod controller;
pub mod fft;
mod processor;
pub use controller::PluginController;
pub use processor::{BANDS, PluginProcessor, decibels};
soundor::export!(PluginProcessor, PluginController);
