#include "JuceTransport.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    void TransportCapture::capture(juce::AudioPlayHead* playHead) noexcept
    {
        if (playHead == nullptr)
            return;
        const auto position = playHead->getPosition();
        if (! position.hasValue())
            return;
        playing.store(position->getIsPlaying(), std::memory_order_relaxed);
        recording.store(position->getIsRecording(), std::memory_order_relaxed);
        looping.store(position->getIsLooping(), std::memory_order_relaxed);
        if (const auto value = position->getBpm())
            bpm.store(*value, std::memory_order_relaxed);
        if (const auto signature = position->getTimeSignature())
        {
            numerator.store(signature->numerator, std::memory_order_relaxed);
            denominator.store(signature->denominator, std::memory_order_relaxed);
        }
        if (const auto value = position->getPpqPosition())
            ppqPosition.store(*value, std::memory_order_relaxed);
        if (const auto value = position->getPpqPositionOfLastBarStart())
            barStartPpq.store(*value, std::memory_order_relaxed);
        if (const auto value = position->getTimeInSeconds())
            timeInSeconds.store(*value, std::memory_order_relaxed);
        if (const auto value = position->getTimeInSamples())
            timeInSamples.store(*value, std::memory_order_relaxed);
        valid.store(true, std::memory_order_release);
    }

    std::optional<platform::Transport> TransportCapture::latest() const noexcept
    {
        if (! valid.load(std::memory_order_acquire))
            return std::nullopt;
        platform::Transport transport;
        transport.playing = playing.load(std::memory_order_relaxed);
        transport.recording = recording.load(std::memory_order_relaxed);
        transport.looping = looping.load(std::memory_order_relaxed);
        transport.bpm = bpm.load(std::memory_order_relaxed);
        transport.timeSignatureNumerator = numerator.load(std::memory_order_relaxed);
        transport.timeSignatureDenominator = denominator.load(std::memory_order_relaxed);
        transport.ppqPosition = ppqPosition.load(std::memory_order_relaxed);
        transport.barStartPpq = barStartPpq.load(std::memory_order_relaxed);
        transport.timeInSeconds = timeInSeconds.load(std::memory_order_relaxed);
        transport.timeInSamples = timeInSamples.load(std::memory_order_relaxed);
        return transport;
    }

    JuceHostInfo::JuceHostInfo(const juce::AudioProcessor& owner, const TransportCapture& capture)
        : processor(owner), transport(capture), hostName(juce::PluginHostType().getHostDescription())
    {
    }

    platform::HostSnapshot JuceHostInfo::snapshot() const
    {
        platform::HostSnapshot snapshot;
        snapshot.sampleRate = processor.getSampleRate();
        snapshot.blockSize = processor.getBlockSize();
        snapshot.hostName = hostName;
        snapshot.transport = transport.latest();
        return snapshot;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
