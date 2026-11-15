#include "RustProcessor.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        constexpr double unknown = std::numeric_limits<double>::quiet_NaN();
    } // namespace

    RustBusLayout RustBusLayout::of(const juce::AudioProcessor& processor)
    {
        RustBusLayout layout;
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

    RustProcessor::RustProcessor(RustContract expected) : contract(expected)
    {
        SoundorProcessorInfo info {};
        if (soundor_processor_info(&info) != SOUNDOR_STATUS_OK || info.abiVersion != SOUNDOR_PROCESSOR_ABI_VERSION)
        {
            problem = "The plugin's Rust processor was built for another Soundor ABI: rebuild it with soundor build.";
            return;
        }
        if (info.parameterCount != contract.parameters || info.publishedCount != contract.published
            || info.channelCount != contract.channels)
        {
            problem = "The plugin's Rust processor was built from another soundor.config (its parameters or channels "
                      "differ): rebuild it with soundor build.";
            return;
        }
        handle = soundor_processor_create();
        if (handle == nullptr)
            problem = "The plugin's Rust processor panicked while it was constructed.";
    }

    RustProcessor::~RustProcessor()
    {
        soundor_processor_destroy(handle);
    }

    std::int32_t RustProcessor::prepare(double sampleRate, int frames, const RustBusLayout& layout,
                                        std::span<const double> parameters)
    {
        prepared = false;
        if (handle == nullptr || frames <= 0)
        {
            status.store(SOUNDOR_STATUS_INVALID_ARGUMENT, std::memory_order_relaxed);
            return SOUNDOR_STATUS_INVALID_ARGUMENT;
        }
        maxFrames = frames;
        inputCounts.clear();
        outputCounts.clear();
        inputChannels.clear();
        outputChannels.clear();
        for (const auto& bus : layout.inputs)
        {
            inputCounts.push_back(static_cast<std::uint32_t>(bus.size()));
            inputChannels.insert(inputChannels.end(), bus.begin(), bus.end());
        }
        for (const auto& bus : layout.outputs)
        {
            outputCounts.push_back(static_cast<std::uint32_t>(bus.size()));
            outputChannels.insert(outputChannels.end(), bus.begin(), bus.end());
        }
        // JUCE processes in place, one buffer channel per index: an input that
        // shares its buffer channel with an output other than its own main one
        // (a sidechain beside an aux output) is copied out before outputs are
        // written.
        const auto mainInputs = layout.inputs.empty() ? std::size_t { 0 } : layout.inputs.front().size();
        const auto mainOutputs = layout.outputs.empty() ? std::size_t { 0 } : layout.outputs.front().size();
        inputCopied.assign(inputChannels.size(), false);
        copiedInputs.clear();
        neededChannels = 0;
        for (const int channel : outputChannels)
            neededChannels = std::max(neededChannels, channel + 1);
        for (std::size_t index = 0; index < inputChannels.size(); ++index)
        {
            const int channel = inputChannels[index];
            neededChannels = std::max(neededChannels, channel + 1);
            const bool inPlace = index < mainInputs && index < mainOutputs && outputChannels[index] == channel;
            const bool shared =
                std::find(outputChannels.begin(), outputChannels.end(), channel) != outputChannels.end();
            if (shared && ! inPlace)
            {
                inputCopied[index] = true;
                copiedInputs.push_back(static_cast<int>(index));
            }
        }
        scratch.setSize(std::max(1, static_cast<int>(copiedInputs.size())), maxFrames, false, true, false);
        chunkPublished.assign(contract.published, unknown);
        inputs.assign(inputChannels.size(), nullptr);
        outputs.assign(outputChannels.size(), nullptr);

        const SoundorPrepare config {
            .size = sizeof(SoundorPrepare),
            .abiVersion = SOUNDOR_PROCESSOR_ABI_VERSION,
            .sampleRate = sampleRate,
            .maxFrames = static_cast<std::uint32_t>(maxFrames),
            .inputBusCount = static_cast<std::uint32_t>(inputCounts.size()),
            .inputChannels = inputCounts.data(),
            .outputBusCount = static_cast<std::uint32_t>(outputCounts.size()),
            .outputChannels = outputCounts.data(),
            .parameterCount = static_cast<std::uint32_t>(parameters.size()),
            .parameters = parameters.data(),
        };
        const auto result = soundor_processor_prepare(handle, &config);
        prepared = result == SOUNDOR_STATUS_OK;
        status.store(result, std::memory_order_relaxed);
        return result;
    }

    std::int32_t RustProcessor::process(juce::AudioBuffer<float>& buffer, std::span<const double> parameters,
                                        std::span<double> published, const SoundorTransport& transport,
                                        const SoundorChannelSink* channels) noexcept
    {
        std::fill(published.begin(), published.end(), unknown);
        const int frames = buffer.getNumSamples();
        auto result = SOUNDOR_STATUS_OK;
        if (! prepared || handle == nullptr)
            result = handle == nullptr ? SOUNDOR_STATUS_FAILED : SOUNDOR_STATUS_NOT_PREPARED;
        else if (buffer.getNumChannels() < neededChannels)
            result = SOUNDOR_STATUS_INVALID_ARGUMENT;
        if (result != SOUNDOR_STATUS_OK)
        {
            // Unprepared, it knows no outputs: everything is silenced.
            if (prepared)
                silence(buffer, 0, frames);
            else
                buffer.clear();
            status.store(result, std::memory_order_relaxed);
            return result;
        }
        // Hosts may pass more frames than they prepared for: in blocks of at
        // most maxFrames, which is what `scratch` holds.
        for (int start = 0; start < frames || (frames == 0 && start == 0); start += maxFrames)
        {
            const int length = std::min(maxFrames, frames - start);
            for (std::size_t slot = 0; length > 0 && slot < copiedInputs.size(); ++slot)
            {
                const auto index = static_cast<std::size_t>(copiedInputs[slot]);
                scratch.copyFrom(static_cast<int>(slot), 0, buffer, inputChannels[index], start, length);
            }
            // An empty block has no sample to point at: its channels' starts.
            const auto read = [&](int channel)
            { return frames == 0 ? buffer.getReadPointer(channel) : buffer.getReadPointer(channel, start); };
            const auto write = [&](int channel)
            { return frames == 0 ? buffer.getWritePointer(channel) : buffer.getWritePointer(channel, start); };
            std::size_t copied = 0;
            for (std::size_t index = 0; index < inputChannels.size(); ++index)
                inputs[index] = inputCopied[index] ? scratch.getReadPointer(static_cast<int>(copied++))
                                                   : read(inputChannels[index]);
            for (std::size_t index = 0; index < outputChannels.size(); ++index)
                outputs[index] = write(outputChannels[index]);
            const SoundorBlock block {
                .size = sizeof(SoundorBlock),
                .abiVersion = SOUNDOR_PROCESSOR_ABI_VERSION,
                .frames = static_cast<std::uint32_t>(length),
                .inputCount = static_cast<std::uint32_t>(inputs.size()),
                .inputs = inputs.data(),
                .outputCount = static_cast<std::uint32_t>(outputs.size()),
                .outputs = outputs.data(),
                .parameterCount = static_cast<std::uint32_t>(parameters.size()),
                .parameters = parameters.data(),
                .publishedCount = static_cast<std::uint32_t>(chunkPublished.size()),
                .published = chunkPublished.data(),
                .transport = &transport,
                .channels = channels,
            };
            result = static_cast<SoundorStatus>(soundor_processor_process(handle, &block));
            if (result != SOUNDOR_STATUS_OK)
            {
                std::fill(published.begin(), published.end(), unknown);
                silence(buffer, start, frames - start);
                break;
            }
            // What a block published is the last value of any of its chunks.
            for (std::size_t slot = 0; slot < chunkPublished.size() && slot < published.size(); ++slot)
                if (! std::isnan(chunkPublished[slot]))
                    published[slot] = chunkPublished[slot];
            if (frames == 0)
                break;
        }
        status.store(result, std::memory_order_relaxed);
        return result;
    }

    std::int32_t RustProcessor::reset() noexcept
    {
        if (handle == nullptr)
            return SOUNDOR_STATUS_FAILED;
        return soundor_processor_reset(handle);
    }

    void RustProcessor::silence(juce::AudioBuffer<float>& buffer, int start, int frames) const noexcept
    {
        if (frames <= 0)
            return;
        for (const int channel : outputChannels)
            if (channel < buffer.getNumChannels())
                buffer.clear(channel, start, frames);
    }

    SoundorTransport RustProcessor::transportOf(juce::AudioPlayHead* playHead) noexcept
    {
        SoundorTransport transport { unknown, unknown, unknown, 0, 0, 0 };
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
