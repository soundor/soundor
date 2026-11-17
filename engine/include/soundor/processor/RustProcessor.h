#pragma once

// A plugin's Rust processor (the project's lib/ crate), called through its
// C ABI (RustProcessorAbi.h): the engine's native side of processor hosting.
// A runtime owns the audio callback and the plugin's lifecycle, and gives
// this the block in place, as one array of channel pointers with each bus's
// channels at known indices (how JUCE's processBlock, and VST3 buffers once
// arranged so, hold them). No JUCE, no allocation and no lock on the audio
// thread.

#include <soundor/Abi.h>
#include <soundor/midi/Midi.h>
#include <soundor/processor/RustProcessorAbi.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
{
    // The processor's C functions. The engine never names the symbols, so it
    // links without a Rust library; a plugin passes linkedRustProcessor().
    struct RustProcessorFunctions
    {
        std::int32_t (*info)(SoundorProcessorInfo* info) = nullptr;
        void* (*create)() = nullptr;
        std::int32_t (*prepare)(void* handle, const SoundorPrepare* config) = nullptr;
        std::int32_t (*process)(void* handle, const SoundorBlock* block) = nullptr;
        std::int32_t (*reset)(void* handle) = nullptr;
        void (*destroy)(void* handle) = nullptr;
    };

    // The functions of the Rust library linked into this binary (what
    // `soundor::export!` defines). Inline, so only a binary that calls it
    // needs the library.
    inline RustProcessorFunctions linkedRustProcessor() noexcept
    {
        return { &soundor_processor_info,    &soundor_processor_create, &soundor_processor_prepare,
                 &soundor_processor_process, &soundor_processor_reset,  &soundor_processor_destroy };
    }

    // Where each bus's channels are in the block's channel array.
    struct RustBusLayout
    {
        // For each bus, in order: the block channel of each of its channels.
        std::vector<std::vector<int>> inputs, outputs;
    };

    // What the runtime expects of the Rust build: a stale one (built from
    // another soundor.config) is refused, and stays silent.
    struct RustContract
    {
        std::uint32_t parameters = 0;
        std::uint32_t published = 0;
        std::uint32_t streams = 0;
        // The size of the state snapshot (`audio: true` fields).
        std::uint32_t stateSize = 0;
    };

    // The transport of a host that tells nothing: NaN, not playing, no
    // time signature.
    SoundorTransport unknownTransport() noexcept;

    // One Rust processor. Construct, prepare and destroy it off the audio
    // thread; process and reset it on the audio thread, never at once.
    // Instances are independent: each has its own handle.
    class RustProcessor
    {
    public:
        RustProcessor(RustContract expected, const RustProcessorFunctions& functions, midi::Functions midi = {});
        ~RustProcessor();
        RustProcessor(const RustProcessor&) = delete;
        RustProcessor& operator=(const RustProcessor&) = delete;
        RustProcessor(RustProcessor&&) = delete;
        RustProcessor& operator=(RustProcessor&&) = delete;

        // Whether the Rust build matched the contract and created a processor;
        // when not, error() says why, and every block is silent.
        [[nodiscard]] bool valid() const noexcept { return handle != nullptr; }
        [[nodiscard]] const std::string& error() const noexcept { return problem; }
        // The Rust processor's handle, for the plugin instance's Rust
        // controller (RustController) to publish its audio resources to; null
        // when not valid().
        [[nodiscard]] void* nativeHandle() const noexcept { return handle; }

        // Off the audio thread: (re)prepares for a sample rate, the most
        // frames a block holds, and the buses' arrangement, allocating what
        // process() needs; the processor sees the parameters' current plain
        // values, and `state` (contract.stateSize bytes, or null for the
        // config's defaults). Returns the processor's status.
        std::int32_t prepare(double sampleRate, int maxFrames, const RustBusLayout& layout,
                             std::span<const double> parameters, const void* state = nullptr);

        // Audio thread: processes `channels`' first `frames` frames in place
        // (the main output's channels hold the main input's on entry), with
        // the parameters' plain values, in the config's order. `published`
        // receives the read-only parameters' values (NaN for none). `state`
        // is the block's state snapshot (contract.stateSize bytes, unchanged
        // for the call, as AudioState::acquire() returns it; null for the
        // config's defaults). Never allocates or locks. Any failure leaves
        // the outputs silent; an unprepared processor silences every channel.
        std::int32_t process(std::span<float* const> channels, int frames, std::span<const double> parameters,
                             std::span<double> published, const SoundorTransport& transport,
                             const SoundorStreamSink* sink, const void* state = nullptr,
                             std::span<const SoundorMidiEvent> midiInput = {},
                             std::span<SoundorMidiEvent> midiOutput = {}, std::uint32_t* midiCount = nullptr) noexcept;

        // Audio thread, between blocks.
        std::int32_t reset() noexcept;

        // The last block's status: a failure is reported off the audio thread.
        [[nodiscard]] std::int32_t lastStatus() const noexcept { return status.load(std::memory_order_relaxed); }

    private:
        void silence(std::span<float* const> channels, int start, int frames) const noexcept;

        RustProcessorFunctions abi;
        midi::Functions midiFunctions;
        std::array<SoundorMidiEvent, midi::capacity> midiInputChunk {}, midiOutputChunk {};
        void* handle = nullptr;
        std::string problem;
        RustContract contract;
        int maxFrames = 0;
        bool prepared = false;
        std::vector<std::uint32_t> inputCounts, outputCounts;
        // Per input channel: its block channel, and whether it shares that
        // with an output other than its own in-place one (so it is copied
        // into `scratch` first).
        std::vector<int> inputChannels, outputChannels;
        std::vector<int> copiedInputs;
        std::vector<bool> inputCopied;
        int neededChannels = 0;
        // copiedInputs.size() channels of maxFrames frames each.
        std::vector<float> scratch;
        std::vector<const float*> inputs;
        std::vector<float*> outputs;
        std::vector<double> chunkPublished;
        std::atomic<std::int32_t> status { SOUNDOR_STATUS_NOT_PREPARED };
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
