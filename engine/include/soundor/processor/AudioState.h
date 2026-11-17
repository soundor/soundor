#pragma once

// The persistent state a plugin's audio processing reads (soundor.config's
// `audio: true` fields), handed from the control side to the audio thread as
// whole snapshots: what the Rust processor sees as `ctx.state`.
//
// It is the streams' triple buffer (js/Streams.h) the other way round: the
// control side is the producer, the audio thread the reader.
//
// - The snapshot is a fixed number of bytes (its layout is the config's,
//   `describeAudioState()`), and its three slots are allocated when this is
//   made: publishing copies into memory only the control side uses, then one
//   atomic exchange.
// - acquire(), on the audio thread, takes the newest published snapshot if
//   there is one, or keeps the one it has: no lock, no allocation, no wait,
//   and no copy, one relaxed load when nothing changed. What it returns
//   stays valid, and unchanged, until the next acquire(): the producer never
//   writes the slot the reader holds.
// - Snapshots published between two acquire() calls are coalesced: the
//   reader sees the latest.
// - publish() and publishWith() may be called from any thread but the
//   audio thread; a mutex serializes them, since the triple buffer has one
//   producer.

#include <soundor/Abi.h>
#include <soundor/js/Streams.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <span>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
{
    class AudioState
    {
    public:
        // Allocates three snapshots of `size` bytes, aligned for any
        // element: not realtime-safe. No snapshot is published yet.
        explicit AudioState(std::size_t size)
            : bytes(size), stream((size + sizeof(std::uint64_t) - 1) / sizeof(std::uint64_t)), core(stream.core().get())
        {
        }

        AudioState(const AudioState&) = delete;
        AudioState& operator=(const AudioState&) = delete;
        AudioState(AudioState&&) = delete;
        AudioState& operator=(AudioState&&) = delete;
        ~AudioState() = default;

        [[nodiscard]] std::size_t size() const noexcept { return bytes; }

        // Off the audio thread: `write(std::span<std::byte>)` writes the
        // next snapshot whole (the slot holds an older snapshot, or zeros),
        // which is then published.
        template <class Write>
        void publishWith(Write&& write)
        {
            const std::lock_guard guard(producer);
            const auto words = stream.buffer();
            write(std::as_writable_bytes(words).first(bytes));
            stream.commit(words.size());
        }

        // Off the audio thread: publishes a copy of `snapshot` (size() bytes).
        void publish(std::span<const std::byte> snapshot)
        {
            publishWith([&](std::span<std::byte> slot)
                        { std::memcpy(slot.data(), snapshot.data(), std::min(slot.size(), snapshot.size())); });
        }

        // Audio thread (one at a time): the newest snapshot, which stays as
        // it is until the next call; nullptr before the first publish().
        [[nodiscard]] const void* acquire() noexcept
        {
            core->take();
            const auto& slot = core->front();
            return slot.sequence == 0 ? nullptr : slot.data;
        }

        // Snapshots published, and how many of them the reader took.
        [[nodiscard]] js::StreamStatistics statistics() const noexcept { return stream.statistics(); }

    private:
        std::size_t bytes;
        std::mutex producer;
        js::BufferStream<std::uint64_t> stream;
        // The stream's shared state, held by `stream`: acquire() copies no
        // shared_ptr on the audio thread.
        js::detail::StreamCore* core;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
