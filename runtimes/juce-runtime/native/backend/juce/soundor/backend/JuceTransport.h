#pragma once

// JUCE backend: realtime-safe capture of the host's transport.

#include <soundor/platform/Platform.h>

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <cstdint>
#include <limits>
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

        // Message thread only. JUCE delivers track metadata here, never on the audio thread.
        void updateTrackProperties(const juce::AudioProcessor::TrackProperties& properties);
        [[nodiscard]] const std::optional<platform::TrackInfo>& trackInfo() const noexcept { return track; }

        // Any thread: nullopt until the host has reported a position.
        [[nodiscard]] std::optional<platform::Transport> latest() const noexcept;

    private:
        static constexpr double unavailable = std::numeric_limits<double>::quiet_NaN();
        std::atomic<double> loopStart { unavailable }, loopEnd { unavailable };
        std::atomic<double> frameRate { unavailable }, originSeconds { unavailable };
        std::atomic<bool> dropFrame { false };
        std::optional<platform::TrackInfo> track;
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

    [[nodiscard]] platform::HostEnvironment hostEnvironment(const juce::AudioProcessor& processor, std::string version);

    // soundor:host over a JUCE processor: its audio setup, the host's name,
    // and the transport its processBlock() captured.
    class JuceHostInfo final : public platform::HostInfo
    {
    public:
        JuceHostInfo(const juce::AudioProcessor& owner, const TransportCapture& capture);

        [[nodiscard]] platform::HostSnapshot snapshot() const override;

    private:
        const juce::AudioProcessor& processor;
        const TransportCapture& transport;
        std::string hostName;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
