#pragma once

// JUCE backend: a plugin's Rust processor (the project's native/ crate),
// called through its C ABI (RustProcessorAbi.h) from processBlock.

#include <soundor/Abi.h>
#include <soundor/backend/RustProcessorAbi.h>

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Where each bus's channels are in processBlock's buffer.
    struct RustBusLayout
    {
        // For each bus, in order: the buffer channel of each of its channels.
        std::vector<std::vector<int>> inputs, outputs;

        // As `processor` arranges its buses now.
        static RustBusLayout of(const juce::AudioProcessor& processor);
    };

    // What the generated processor expects of the Rust build: a stale one
    // (built from another soundor.config) is refused, and stays silent.
    struct RustContract
    {
        std::uint32_t parameters = 0;
        std::uint32_t published = 0;
        std::uint32_t channels = 0;
    };

    // One Rust processor. Construct, prepare and destroy it on the message
    // thread; process and reset it on the audio thread, never at once.
    class RustProcessor
    {
    public:
        explicit RustProcessor(RustContract expected);
        ~RustProcessor();
        RustProcessor(const RustProcessor&) = delete;
        RustProcessor& operator=(const RustProcessor&) = delete;
        RustProcessor(RustProcessor&&) = delete;
        RustProcessor& operator=(RustProcessor&&) = delete;

        // Whether the Rust build matched the contract and created a processor;
        // when not, error() says why, and every block is silent.
        [[nodiscard]] bool valid() const noexcept { return handle != nullptr; }
        [[nodiscard]] const std::string& error() const noexcept { return problem; }

        // Message thread: (re)prepares for a sample rate, the most frames a
        // block holds, and the buses' arrangement, allocating what process()
        // needs; the processor sees the parameters' current plain values.
        // Returns the processor's status.
        std::int32_t prepare(double sampleRate, int maxFrames, const RustBusLayout& layout,
                             std::span<const double> parameters);

        // Audio thread: processes `buffer` in place (the main output's channels
        // hold the main input's on entry), with the parameters' plain values,
        // in the config's order. `published` receives the read-only
        // parameters' values (NaN for none). Never allocates or locks. Any
        // failure leaves the outputs silent.
        std::int32_t process(juce::AudioBuffer<float>& buffer, std::span<const double> parameters,
                             std::span<double> published, const SoundorTransport& transport,
                             const SoundorChannelSink* channels) noexcept;

        // Audio thread, between blocks.
        std::int32_t reset() noexcept;

        // The last block's status: a failure is reported on the message thread.
        [[nodiscard]] std::int32_t lastStatus() const noexcept { return status.load(std::memory_order_relaxed); }

        // The transport `processBlock` passes, from the host's play head.
        static SoundorTransport transportOf(juce::AudioPlayHead* playHead) noexcept;

    private:
        void silence(juce::AudioBuffer<float>& buffer, int start, int frames) const noexcept;

        void* handle = nullptr;
        std::string problem;
        RustContract contract;
        int maxFrames = 0;
        bool prepared = false;
        std::vector<std::uint32_t> inputCounts, outputCounts;
        // Per input channel: its buffer channel, and whether it shares that
        // with an output other than its own in-place one (so it is copied
        // into `scratch` first).
        std::vector<int> inputChannels, outputChannels;
        std::vector<int> copiedInputs;
        std::vector<bool> inputCopied;
        int neededChannels = 0;
        juce::AudioBuffer<float> scratch;
        std::vector<const float*> inputs;
        std::vector<float*> outputs;
        std::vector<double> chunkPublished;
        std::atomic<std::int32_t> status { SOUNDOR_STATUS_NOT_PREPARED };
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
