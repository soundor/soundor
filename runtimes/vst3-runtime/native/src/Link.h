#pragma once

// What a plugin instance's controller may share with its processor when both
// run in one process, which VST3 never promises: the controller finds its
// processor's Link through the token the processor sends it (an IMessage, so
// a host that runs them apart, or routes their messages through a proxy,
// still connects them: only a token from this very module resolves).
//
// Through it the controller reaches the processor's Rust handle (the Rust
// controller's audio resources, the UI's soundor:midi) and its native
// streams. Without one, those features are off; parameters, state and
// everything else go through VST3 as usual.

#include "Descriptor.h"

#include <soundor/js/Streams.h>
#include <soundor/midi/Midi.h>
#include <soundor/processor/RustProcessor.h>
#include <soundor/processor/RustProcessorAbi.h>

#include <atomic>
#include <cstdint>
#include <limits>
#include <memory>
#include <vector>

namespace soundor::vst3
{
    namespace js = soundor::js;
    namespace processor = soundor::processor;

    // The plugin's native streams (`native.streams`), which the Rust
    // processing publishes on the audio thread and each editor reads.
    class Streams
    {
    public:
        explicit Streams(const Plugin& plugin);

        [[nodiscard]] const std::vector<std::shared_ptr<js::detail::StreamCore>>& cores() const noexcept
        {
            return streams;
        }
        // The Rust processor's sink: realtime-safe callbacks on these streams.
        [[nodiscard]] const SoundorStreamSink* sink() const noexcept { return streams.empty() ? nullptr : &table; }

    private:
        std::vector<std::shared_ptr<js::detail::StreamCore>> streams;
        SoundorStreamSink table {};
    };

    namespace midi = soundor::midi;

    // The latest host context the processing saw, for soundor:host. Written
    // by the audio thread, read by the UI's; each field is atomic.
    struct HostState
    {
        static constexpr double unavailable = std::numeric_limits<double>::quiet_NaN();

        std::atomic<double> sampleRate { 0 };
        std::atomic<int> blockSize { 0 };
        std::atomic<int> processingMode { -1 };
        std::atomic<bool> known { false };
        std::atomic<bool> playing { false };
        std::atomic<bool> recording { false };
        std::atomic<bool> looping { false };
        std::atomic<double> bpm { 0 };
        std::atomic<int> numerator { 4 };
        std::atomic<int> denominator { 4 };
        std::atomic<double> ppq { 0 };
        std::atomic<double> barStart { 0 };
        std::atomic<double> seconds { 0 };
        std::atomic<std::int64_t> samples { 0 };
        std::atomic<double> loopStart { unavailable };
        std::atomic<double> loopEnd { unavailable };
        std::atomic<double> frameRate { 0 };
        std::atomic<bool> dropFrame { false };
        std::atomic<std::int32_t> smpteOffset { 0 };
    };

    struct Link
    {
        std::shared_ptr<processor::RustProcessor> rust;
        std::shared_ptr<Streams> streams;
        std::shared_ptr<HostState> host;
    };

    // The processor registers its link and sends the token; the controller
    // resolves it. Tokens are never reused within a module.
    std::uint64_t publishLink(const std::shared_ptr<Link>& link);
    void withdrawLink(std::uint64_t token);
    [[nodiscard]] std::shared_ptr<Link> resolveLink(std::uint64_t token);
    // A value identifying this module (this loaded plugin binary).
    [[nodiscard]] std::int64_t moduleIdentity() noexcept;
} // namespace soundor::vst3
