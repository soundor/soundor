#pragma once

// The `soundor:*` modules the VST3 runtime installs in each editor's
// JavaScript context, beside the engine's own (ui, parameters, history,
// midi, host, storage, fs): what the JUCE runtime generates per plugin,
// written once here and driven by the descriptor.
//
// - soundor:state: one object per field (get, set, beginGesture, endGesture,
//   subscribe) and onRestored, converting between JavaScript values and the
//   field's canonical JSON by its type, with the generated bindings' rules
//   (64-bit integers as bigints, deeply frozen values, the same errors).
// - soundor:presets: the factory presets (list, load), the selection
//   (getSnapshot, subscribe).
// - soundor:native: the Rust controller's methods, the declared streams
//   (fed by the processor when it shares this process), the declared events
//   (which only C++ publishes, so nothing ever arrives here).

#include <soundor/js/Context.h>

namespace soundor::vst3
{
    class Controller;
    class FactoryPresets;

    namespace modules
    {
        namespace js = soundor::js;

        void installState(js::Context& context, Controller& controller);
        void dispatchState(js::Context& context);
        void installPresets(js::Context& context, FactoryPresets& presets);
        void dispatchPresets(js::Context& context);
        // Nothing when the plugin declares no native API.
        void installNative(js::Context& context, Controller& controller);
    } // namespace modules
} // namespace soundor::vst3
