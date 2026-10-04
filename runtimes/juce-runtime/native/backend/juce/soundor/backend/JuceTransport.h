#pragma once

// JUCE backend: realtime-safe capture of the host's transport.

#include <soundor/platform/Platform.h>

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <cstdint>
#include <optional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // The latest play-head position, written on the audio thread every block
    // and read on the UI thread. Lock-free and allocation-free; each field is
    // individually atomic, which is precise enough for display.
    class TransportCapture
    {
    public:
        // Audio thread.
        void capture(juce::AudioPlayHead* playHead) noexcept;

        // Any thread: nullopt until the host has reported a position.
        [[nodiscard]] std::optional<platform::Transport> latest() const noexcept;

    private:
        std::atomic<bool> valid { false };
        std::atomic<bool> playing { false };
        std::atomic<bool> recording { false };
        std::atomic<bool> looping { false };
        std::atomic<double> bpm { 0 };
        std::atomic<int> numerator { 4 };
        std::atomic<int> denominator { 4 };
        std::atomic<double> ppqPosition { 0 };
        std::atomic<double> barStartPpq { 0 };
        std::atomic<double> timeInSeconds { 0 };
        std::atomic<std::int64_t> timeInSamples { 0 };
    };

    // soundor:host over a JUCE processor: its audio setup, the host's name,
    // and the transport its processBlock() captured.
    class JuceHostInfo final : public platform::HostInfo
    {
    public:
        JuceHostInfo(const juce::AudioProcessor& processor, const TransportCapture& transport);

        [[nodiscard]] platform::HostSnapshot snapshot() const override;

    private:
        const juce::AudioProcessor& processor;
        const TransportCapture& transport;
        std::string hostName;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
