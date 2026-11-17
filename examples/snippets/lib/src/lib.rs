//! The plugin's Rust entry point.
mod controller;
mod processor;
pub use controller::PluginController;
pub use processor::PluginProcessor;
soundor::export!(PluginProcessor, PluginController);
