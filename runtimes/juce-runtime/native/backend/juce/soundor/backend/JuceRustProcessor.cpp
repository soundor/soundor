#include "JuceRustProcessor.h"

#include <algorithm>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    processor::RustBusLayout rustBusLayout(const juce::AudioProcessor& processor)
    {
        processor::RustBusLayout layout;
        for (const bool input : { true, false })
        {
            auto& buses = input ? layout.inputs : layout.outputs;
            const int count = processor.getBusCount(input);
            buses.resize(static_cast<std::size_t>(count));
            for (int bus = 0; bus < count; ++bus)
            {
                const int channels = processor.getChannelCountOfBus(input, bus);
                for (int channel = 0; channel < channels; ++channel)
                    buses[static_cast<std::size_t>(bus)].push_back(
                        processor.getChannelIndexInProcessBlockBuffer(input, bus, channel));
            }
        }
        return layout;
    }

    SoundorTransport rustTransport(juce::AudioPlayHead* playHead) noexcept
    {
        auto transport = processor::unknownTransport();
        if (playHead == nullptr)
            return transport;
        const auto position = playHead->getPosition();
        if (! position.hasValue())
            return transport;
        transport.flags = position->getIsPlaying() ? 1u : 0u;
        if (const auto bpm = position->getBpm())
            transport.tempo = *bpm;
        if (const auto seconds = position->getTimeInSeconds())
            transport.timeSeconds = *seconds;
        if (const auto ppq = position->getPpqPosition())
            transport.positionBeats = *ppq;
        if (const auto signature = position->getTimeSignature())
        {
            transport.timeSignatureNumerator = static_cast<std::uint32_t>(std::max(0, signature->numerator));
            transport.timeSignatureDenominator = static_cast<std::uint32_t>(std::max(0, signature->denominator));
        }
        return transport;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
