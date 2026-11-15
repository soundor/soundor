#pragma once

// The C ABI between a native runtime and a plugin's Rust processor: what
// `soundor::export!` defines in the project's `native/` crate (see the SDK's
// ffi.rs, whose #[repr(C)] structures these mirror field for field). The
// engine declares it and never calls these symbols itself: the plugin's
// binary links the library that defines them, and hands them to
// processor::RustProcessor (linkedRustProcessor() in RustProcessor.h).
//
// - Every structure starts with its size and the ABI version; a call with
//   another version returns SOUNDOR_STATUS_ABI_MISMATCH.
// - The processor is an opaque handle from soundor_processor_create, freed by
//   soundor_processor_destroy, both outside the audio thread.
// - The caller owns every buffer it passes, for the duration of the call.
// - Nothing unwinds across the boundary: a Rust panic becomes a status.
// - Calls on one handle never overlap; process and reset are realtime-safe.

#include <cstdint>

// The version every structure carries, as the SDK's ffi.rs has it.
inline constexpr std::uint32_t SOUNDOR_PROCESSOR_ABI_VERSION = 1;

extern "C"
{
    enum SoundorStatus : std::int32_t
    {
        SOUNDOR_STATUS_OK = 0,
        SOUNDOR_STATUS_INVALID_ARGUMENT = 1,
        SOUNDOR_STATUS_NOT_PREPARED = 2,
        SOUNDOR_STATUS_FAILED = 3,
        SOUNDOR_STATUS_PANICKED = 4,
        SOUNDOR_STATUS_ABI_MISMATCH = 5,
    };

    struct SoundorProcessorInfo
    {
        std::uint32_t size;
        std::uint32_t abiVersion;
        std::uint32_t parameterCount;
        std::uint32_t publishedCount;
        std::uint32_t channelCount;
    };

    struct SoundorPrepare
    {
        std::uint32_t size;
        std::uint32_t abiVersion;
        double sampleRate;
        std::uint32_t maxFrames;
        std::uint32_t inputBusCount;
        const std::uint32_t* inputChannels;
        std::uint32_t outputBusCount;
        const std::uint32_t* outputChannels;
        // The parameters' current plain values, as prepare sees them; null
        // keeps the last ones.
        std::uint32_t parameterCount;
        const double* parameters;
    };

    // NaN (or 0 for the time signature) where the host does not say.
    struct SoundorTransport
    {
        double tempo;
        double timeSeconds;
        double positionBeats;
        std::uint32_t flags; // bit 0: playing
        std::uint32_t timeSignatureNumerator;
        std::uint32_t timeSignatureDenominator;
    };

    struct SoundorChannelSink
    {
        void* user;
        void (*publish)(void* user, std::uint32_t index, double value);
        void* (*buffer)(void* user, std::uint32_t index, std::uint32_t* capacity);
        void (*commit)(void* user, std::uint32_t index, std::uint32_t length);
    };

    struct SoundorBlock
    {
        std::uint32_t size;
        std::uint32_t abiVersion;
        std::uint32_t frames;
        // One pointer per channel of each prepared bus, in bus order. Main
        // input channel c may be the very pointer of main output channel c.
        std::uint32_t inputCount;
        const float* const* inputs;
        std::uint32_t outputCount;
        float* const* outputs;
        // Plain values in the config's order; null keeps the last block's.
        std::uint32_t parameterCount;
        const double* parameters;
        // NaN where the block published no value.
        std::uint32_t publishedCount;
        double* published;
        const SoundorTransport* transport;  // may be null
        const SoundorChannelSink* channels; // may be null
    };

    std::int32_t soundor_processor_info(SoundorProcessorInfo* info);
    void* soundor_processor_create();
    std::int32_t soundor_processor_prepare(void* handle, const SoundorPrepare* config);
    std::int32_t soundor_processor_process(void* handle, const SoundorBlock* block);
    std::int32_t soundor_processor_reset(void* handle);
    void soundor_processor_destroy(void* handle);
}
