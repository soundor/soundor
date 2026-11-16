//! The plugin instance's controller stores.
use soundor::prelude::*;

#[derive(Default)]
pub struct LocalStore {}
#[derive(Default)]
pub struct SharedStore {}
pub struct PluginController;
impl Controller for PluginController {
    type Local = LocalStore;
    type Shared = SharedStore;
}
