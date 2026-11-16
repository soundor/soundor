#pragma once

// JUCE backend: what the engine's Rust processor bridge
// (soundor/processor/RustProcessor.h) needs from JUCE: where processBlock's
// buffer holds each bus's channels, the host's transport, and the buffer
// itself. The generated processor owns the callback and the lifecycle.

#include <soundor/processor/RustProcessor.h>

#include <juce_audio_processors/juce_audio_processors.h>

#include <span>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // As `processor` arranges its buses now.
    processor::RustBusLayout rustBusLayout(const juce::AudioProcessor& processor);

    // The transport `processBlock` passes, from the host's play head.
    SoundorTransport rustTransport(juce::AudioPlayHead* playHead) noexcept;

    // Processes `buffer` in place (see processor::RustProcessor::process).
    inline std::int32_t processRust(processor::RustProcessor& rust, juce::AudioBuffer<float>& buffer,
                                    std::span<const double> parameters, std::span<double> published,
                                    const SoundorTransport& transport, const SoundorStreamSink* sink) noexcept
    {
        return rust.process({ buffer.getArrayOfWritePointers(), static_cast<std::size_t>(buffer.getNumChannels()) },
                            buffer.getNumSamples(), parameters, published, transport, sink);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
