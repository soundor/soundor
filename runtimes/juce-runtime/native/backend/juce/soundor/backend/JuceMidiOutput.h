#pragma once

#include <soundor/Abi.h>

#include <juce_audio_basics/juce_audio_basics.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // JUCE format wrappers retain their MIDI buffer between callbacks. Reclaim
    // our storage before filling it again: a swap at the end alone would leave
    // the next callback with the wrapper's smaller allocation.
    class MidiOutputBuffer
    {
    public:
        void prepare()
        {
            buffer.ensureSize(16384);
            storage = buffer.data.begin();
            buffer.clear();
        }

        bool acquire(juce::MidiBuffer& host) noexcept
        {
            if (host.data.begin() == storage)
                buffer.swapWith(host);
            if (storage == nullptr || buffer.data.begin() != storage)
                return false;
            buffer.clear();
            return true;
        }

        juce::MidiBuffer& events() noexcept { return buffer; }
        void publish(juce::MidiBuffer& host) noexcept { buffer.swapWith(host); }

    private:
        juce::MidiBuffer buffer;
        const void* storage = nullptr;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
