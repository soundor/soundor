#include <soundor/processor/RustProcessor.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
{
    namespace
    {
        constexpr double unknown = std::numeric_limits<double>::quiet_NaN();
    } // namespace

    SoundorTransport unknownTransport() noexcept
    {
        return { unknown, unknown, unknown, 0, 0, 0 };
    }

    RustProcessor::RustProcessor(RustContract expected, const RustProcessorFunctions& functions)
        : abi(functions), contract(expected)
    {
        if (abi.info == nullptr || abi.create == nullptr || abi.prepare == nullptr || abi.process == nullptr
            || abi.reset == nullptr || abi.destroy == nullptr)
        {
            problem = "The plugin's Rust processor is missing a function of the Soundor ABI.";
            return;
        }
        SoundorProcessorInfo info {};
        if (abi.info(&info) != SOUNDOR_STATUS_OK || info.abiVersion != SOUNDOR_PROCESSOR_ABI_VERSION)
        {
            problem = "The plugin's Rust processor was built for another Soundor ABI: rebuild it with soundor build.";
            return;
        }
        if (info.parameterCount != contract.parameters || info.publishedCount != contract.published
            || info.streamCount != contract.streams)
        {
            problem = "The plugin's Rust processor was built from another soundor.config (its parameters or streams "
                      "differ): rebuild it with soundor build.";
            return;
        }
        handle = abi.create();
        if (handle == nullptr)
            problem = "The plugin's Rust processor panicked while it was constructed.";
    }

    RustProcessor::~RustProcessor()
    {
        if (handle != nullptr)
            abi.destroy(handle);
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
        // The block is processed in place, one channel per index: an input
        // that shares its channel with an output other than its own main one
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
        scratch.assign(std::max<std::size_t>(1, copiedInputs.size()) * static_cast<std::size_t>(maxFrames), 0.0F);
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
        const auto result = abi.prepare(handle, &config);
        prepared = result == SOUNDOR_STATUS_OK;
        status.store(result, std::memory_order_relaxed);
        return result;
    }

    std::int32_t RustProcessor::process(std::span<float* const> channels, int frames,
                                        std::span<const double> parameters, std::span<double> published,
                                        const SoundorTransport& transport, const SoundorStreamSink* sink) noexcept
    {
        std::fill(published.begin(), published.end(), unknown);
        frames = std::max(0, frames);
        std::int32_t result = SOUNDOR_STATUS_OK;
        if (! prepared || handle == nullptr)
            result = handle == nullptr ? SOUNDOR_STATUS_FAILED : SOUNDOR_STATUS_NOT_PREPARED;
        else if (std::cmp_less(channels.size(), neededChannels))
            result = SOUNDOR_STATUS_INVALID_ARGUMENT;
        if (result != SOUNDOR_STATUS_OK)
        {
            // Unprepared, it knows no outputs: everything is silenced.
            if (prepared)
                silence(channels, 0, frames);
            else
                for (float* channel : channels)
                    std::fill_n(channel, frames, 0.0F);
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
                const float* from = channels[static_cast<std::size_t>(inputChannels[index])] + start;
                std::copy_n(from, length, scratch.data() + (slot * static_cast<std::size_t>(maxFrames)));
            }
            std::size_t copied = 0;
            for (std::size_t index = 0; index < inputChannels.size(); ++index)
                inputs[index] = inputCopied[index] ? scratch.data() + (copied++ * static_cast<std::size_t>(maxFrames))
                                                   : channels[static_cast<std::size_t>(inputChannels[index])] + start;
            for (std::size_t index = 0; index < outputChannels.size(); ++index)
                outputs[index] = channels[static_cast<std::size_t>(outputChannels[index])] + start;
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
                .streams = sink,
            };
            result = abi.process(handle, &block);
            if (result != SOUNDOR_STATUS_OK)
            {
                std::fill(published.begin(), published.end(), unknown);
                silence(channels, start, frames - start);
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
        return abi.reset(handle);
    }

    void RustProcessor::silence(std::span<float* const> channels, int start, int frames) const noexcept
    {
        if (frames <= 0)
            return;
        for (const int channel : outputChannels)
            if (std::cmp_less(channel, channels.size()))
                std::fill_n(channels[static_cast<std::size_t>(channel)] + start, frames, 0.0F);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
