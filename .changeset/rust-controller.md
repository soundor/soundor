---
'soundor': minor
'@soundor/core': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
---

A plugin's `soundor:native` methods can be Rust: the crate's controller, on the control thread beside the UI, typed by soundor.config, with async tasks that schedule back onto it.

- `soundor` (the Rust SDK): **breaking**, the processor trait `AudioProcessor` is now `Processor` (`impl Processor for PluginProcessor`); its lifecycle is unchanged. New: `Controller` (`type Local`, `type Shared`: two stores Soundor owns per plugin instance), the generated `NativeMethods` trait (every configured method required, with its types, sync or async as declared; a config without methods needs no `impl`), `TaskContext` (the stores, typed `params` and `state`, `history`, `presets`, the processor's resources; neither `Send` nor kept past its call), `AsyncTaskContext` (owned and `Send`: the shared store, the resources, and `schedule()`, lazy, cancelled when dropped while queued, never interrupted once running), `soundor::unblock()`, `soundor::Error`, `soundor::types` (the config's native types), and `soundor::testing::TestController` with `TestHost`. `soundor::export!(PluginProcessor, PluginController)` exports a controller with the processor; `soundor::export!(PluginProcessor)` still exports a processor alone. `soundor init` scaffolds `lib/src/controller.rs` when the config declares methods, and names the processor `PluginProcessor`.
- `@soundor/core`: `describeController()`, the controller descriptor both the Rust SDK and the runtime's generated code hold.
- `@soundor/engine`: `soundor/processor/RustController.h` (`processor::RustController`, `ControllerServices`, `ControllerContract`) and `RustControllerAbi.h`, the bridge to a controller's C ABI, and generic `soundor:native` bindings (`js/RustMethods.h`) that check and convert values as the generated C++ bindings do, settle async methods' promises when the controller is pumped and run the context's microtasks after. `RustProcessor::nativeHandle()`.
- `@soundor/juce-runtime`: the generated processor creates the Rust controller with the plugin instance (`rustController()`), backs it with the parameter editors, state store, History and presets, pumps it on the message thread through an `AsyncUpdater`, and shuts it down first; every editor installs its methods (`native::installController()`), ahead of `createNativeApi()`. `SoundorNative.h` holds the controller descriptor.
