#pragma once

// The VST3 runtime's private C ABI: what the generic adapter (this
// directory, prebuilt as libsoundor_vst3.a) asks of the plugin's Rust side.
//
// The adapter is the same for every plugin; what makes a plugin itself comes
// from the plugin's binary at run time, through this one function, which the
// VST3 runtime's Rust crate (runtimes/vst3-runtime/rust, `soundor_vst3`)
// defines in the crate `soundor build vst3` generates for the project:
//
// - the plugin's description, as JSON (the runtime's `descriptor.ts`): its
//   identity and VST3 class ids, audio layouts, MIDI, editor, parameters
//   with their behaviour (expressions), persistent state, presets, native
//   streams;
// - the controller descriptor (@soundor/core's describeController()), which
//   the engine's RustController checks the plugin's controller against;
// - the UI's files (bundle.js or its bytecode, assets), or the directory a
//   development build reads them from.
//
// The processor, the controller and MIDI are not part of this ABI: they are
// the plugin crate's `soundor::export!` ABI (RustProcessorAbi.h,
// RustControllerAbi.h, midi/Midi.h in the engine), which the adapter calls
// through the engine's RustProcessor, RustController and midi::Host, as the
// JUCE runtime does.
//
// Rules:
// - Every structure starts with its size and SOUNDOR_VST3_ABI_VERSION; the
//   adapter refuses another version (the plugin then fails to load, saying
//   why in the log).
// - Everything this returns is static: owned by the Rust side, never freed,
//   valid for as long as the plugin's module is loaded. The adapter only
//   reads it.
// - soundor_vst3_plugin may be called on any thread, any number of times. It
//   never unwinds: the Rust side has nothing in it that can panic.

#include <cstddef>
#include <cstdint>

// The version every structure of this ABI carries, as `soundor_vst3`'s ABI_VERSION.
inline constexpr std::uint32_t SOUNDOR_VST3_ABI_VERSION = 1;

extern "C"
{
    // A file of the UI: `path` relative to the UI's root ("bundle.js.hbc",
    // "assets/9f86d081.png"), UTF-8, not NUL-terminated.
    struct SoundorVst3File
    {
        const char* path;
        std::size_t pathLength;
        const std::uint8_t* data;
        std::size_t size;
    };

    struct SoundorVst3Plugin
    {
        std::uint32_t size;
        std::uint32_t abiVersion;
        // The plugin's description: UTF-8 JSON.
        const std::uint8_t* descriptor;
        std::size_t descriptorSize;
        // The controller descriptor (describeController()'s bytes).
        const std::uint8_t* controllerDescriptor;
        std::size_t controllerDescriptorSize;
        // The UI's files, embedded; none when uiDirectory is set or the
        // project has no UI.
        const SoundorVst3File* files;
        std::size_t fileCount;
        // A development build's UI directory (absolute, UTF-8), read at every
        // editor opening; empty for an embedded UI.
        const char* uiDirectory;
        std::size_t uiDirectoryLength;
        // A development build's log file (absolute, UTF-8), which `soundor
        // dev` tails for the UI's console; empty: the UI logs to stderr.
        const char* logFile;
        std::size_t logFileLength;
    };

    // Fills `plugin` (its `size` set by the caller to sizeof(SoundorVst3Plugin)):
    // 0, or nonzero when the caller's structure is too small.
    std::int32_t soundor_vst3_plugin(SoundorVst3Plugin* plugin);
}
