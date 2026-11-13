#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <span>
#include <type_traits>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    class Context;

    // Latest-value channels from native code to the UI: what a plugin's
    // generated `native::Channels` (soundor.config `native.channels`) holds,
    // and the `channels` of `soundor:native` read.
    //
    // A channel is a number or a buffer of up to `maxLength` numbers that one
    // producer keeps replacing (a meter's level, an analyzer's spectrum), and
    // the UI shows the latest of:
    //
    // - Realtime-safe publishing: publish(), buffer() and commit() take no
    //   lock, never allocate (a buffer's storage is allocated when the
    //   channel is made), never wait and never run JavaScript: a copy into
    //   memory only the producer uses, then one atomic exchange. Call them
    //   from the audio callback.
    // - One producer at a time: calls on a channel's producer side must not
    //   overlap (a host may move the audio callback between threads, never
    //   run it twice at once). Different channels are independent.
    // - Never torn: the UI reads a value only once its producer committed it
    //   whole, from memory the producer no longer writes (a triple buffer:
    //   one slot the producer fills, one the UI reads, one handed between
    //   them). Neither side waits for the other.
    // - Latest only: values the UI did not take before newer ones arrived are
    //   skipped, never queued, so a slow, hidden or closed UI costs nothing
    //   and accumulates nothing. Every value carries its sequence number (1
    //   for the first), so a gap counts what was skipped.
    // - The UI side runs on the UI thread only (deliverChannels(), from
    //   RuntimeHost::tick): every context connected to a channel receives at
    //   most one value of it per tick, the newest, and a context connected
    //   later starts with the value published last. Before any publication a
    //   channel has no value.
    //
    // A channel outlives or not the contexts reading it: either may go first.

    namespace detail
    {
        enum class ChannelElement : std::uint8_t
        {
            Int8,
            Uint8,
            Int16,
            Uint16,
            Int32,
            Uint32,
            Int64,
            Uint64,
            Float32,
            Float64,
        };

        template <typename T>
        consteval ChannelElement channelElement()
        {
            if constexpr (std::is_same_v<T, std::int8_t>)
                return ChannelElement::Int8;
            else if constexpr (std::is_same_v<T, std::uint8_t>)
                return ChannelElement::Uint8;
            else if constexpr (std::is_same_v<T, std::int16_t>)
                return ChannelElement::Int16;
            else if constexpr (std::is_same_v<T, std::uint16_t>)
                return ChannelElement::Uint16;
            else if constexpr (std::is_same_v<T, std::int32_t>)
                return ChannelElement::Int32;
            else if constexpr (std::is_same_v<T, std::uint32_t>)
                return ChannelElement::Uint32;
            else if constexpr (std::is_same_v<T, std::int64_t>)
                return ChannelElement::Int64;
            else if constexpr (std::is_same_v<T, std::uint64_t>)
                return ChannelElement::Uint64;
            else if constexpr (std::is_same_v<T, float>)
                return ChannelElement::Float32;
            else
            {
                static_assert(std::is_same_v<T, double>, "a channel holds a fixed-width number type");
                return ChannelElement::Float64;
            }
        }

        // What every channel shares, whatever its element type: three slots
        // and the index of the one between producer and UI. Allocated when
        // the channel is made; shared with the contexts reading it.
        class ChannelCore
        {
        public:
            struct Slot
            {
                void* data = nullptr;
                std::size_t length = 0;
                std::uint64_t sequence = 0;
            };

            ChannelCore(ChannelElement type, bool isBuffer, std::size_t capacity) noexcept
                : element(type), buffer(isBuffer), maxLength(capacity)
            {
            }

            virtual ~ChannelCore() = default;

            ChannelCore(const ChannelCore&) = delete;
            ChannelCore& operator=(const ChannelCore&) = delete;
            ChannelCore(ChannelCore&&) = delete;
            ChannelCore& operator=(ChannelCore&&) = delete;

            const ChannelElement element;
            // A buffer (a typed array in JavaScript), not one number.
            const bool buffer;
            const std::size_t maxLength;

            // ── Producer side (one thread at a time) ──

            // The slot the producer fills; nobody else touches it.
            [[nodiscard]] Slot& back() noexcept { return slots[backIndex]; }

            // Hands the filled back slot to the UI, numbered, and takes the
            // one between them to fill next.
            void commit(std::size_t length) noexcept
            {
                Slot& slot = slots[backIndex];
                slot.length = std::min(length, maxLength);
                slot.sequence = ++sequence;
                // Release: the slot's contents are visible to whoever takes
                // it. Acquire: the UI is done with the slot handed back.
                backIndex = middle.exchange(backIndex | fresh, std::memory_order_acq_rel) & indexMask;
                published.store(slot.sequence, std::memory_order_relaxed);
            }

            // ── UI side (the UI thread) ──

            // Takes the newest committed slot, if one arrived since the last
            // call, as the one the UI reads. Then front() is the latest value.
            bool take() noexcept
            {
                if ((middle.load(std::memory_order_relaxed) & fresh) == 0)
                    return false;
                // Acquire: the producer's writes to the slot taken. Release:
                // the UI's reads of the slot given back happen before the
                // producer refills it.
                frontIndex = middle.exchange(frontIndex, std::memory_order_acq_rel) & indexMask;
                taken.fetch_add(1, std::memory_order_relaxed);
                return true;
            }

            // The value the UI reads (sequence 0: none yet).
            [[nodiscard]] const Slot& front() const noexcept { return slots[frontIndex]; }

            // ── Any thread ──

            // Values published so far, and how many of them the UI took (the
            // others were skipped for newer ones).
            [[nodiscard]] std::uint64_t publishedCount() const noexcept
            {
                return published.load(std::memory_order_relaxed);
            }
            [[nodiscard]] std::uint64_t takenCount() const noexcept { return taken.load(std::memory_order_relaxed); }

        protected:
            std::array<Slot, 3> slots {};

        private:
            static constexpr std::uint32_t indexMask = 3;
            static constexpr std::uint32_t fresh = 4;
            static_assert(std::atomic<std::uint32_t>::is_always_lock_free);
            static_assert(std::atomic<std::uint64_t>::is_always_lock_free);

            // The slot between producer and UI, and whether it holds a value
            // the UI has not taken.
            std::atomic<std::uint32_t> middle { 1 };
            // Owned by the producer.
            std::uint32_t backIndex = 0;
            std::uint64_t sequence = 0;
            // Owned by the UI thread.
            std::uint32_t frontIndex = 2;

            std::atomic<std::uint64_t> published { 0 };
            std::atomic<std::uint64_t> taken { 0 };
        };

        template <typename T>
        class ChannelStorage final : public ChannelCore
        {
        public:
            ChannelStorage(bool isBuffer, std::size_t capacity)
                : ChannelCore(channelElement<T>(), isBuffer, capacity),
                  storage { std::vector<T>(capacity), std::vector<T>(capacity), std::vector<T>(capacity) }
            {
                for (std::size_t index = 0; index < slots.size(); ++index)
                    slots[index].data = storage[index].data();
            }

            [[nodiscard]] std::span<T> backData() noexcept { return { static_cast<T*>(back().data), maxLength }; }

        private:
            std::array<std::vector<T>, 3> storage;
        };
    } // namespace detail

    struct ChannelStatistics
    {
        // Values published.
        std::uint64_t published = 0;
        // Values the UI took; the others were coalesced (skipped for a newer
        // one) or are waiting to be taken (at most one).
        std::uint64_t taken = 0;
    };

    // The base of both kinds of channel: its shared state, for bindings.
    class Channel
    {
    public:
        Channel(const Channel&) = delete;
        Channel& operator=(const Channel&) = delete;
        Channel(Channel&&) = delete;
        Channel& operator=(Channel&&) = delete;

        [[nodiscard]] ChannelStatistics statistics() const noexcept
        {
            return { state->publishedCount(), state->takenCount() };
        }

        [[nodiscard]] std::shared_ptr<detail::ChannelCore> core() const noexcept { return state; }

    protected:
        explicit Channel(std::shared_ptr<detail::ChannelCore> core) : state(std::move(core)) {}
        ~Channel() = default;

        std::shared_ptr<detail::ChannelCore> state;
    };

    // A channel of one number.
    template <typename T>
    class ValueChannel final : public Channel
    {
    public:
        ValueChannel() : ValueChannel(std::make_shared<detail::ChannelStorage<T>>(false, 1)) {}

        // Realtime-safe (see above).
        void publish(T value) noexcept
        {
            storage->backData()[0] = value;
            storage->commit(1);
        }

    private:
        explicit ValueChannel(std::shared_ptr<detail::ChannelStorage<T>> made) : Channel(made), storage(made.get()) {}

        detail::ChannelStorage<T>* storage;
    };

    // A channel of a buffer of up to maxLength() numbers.
    template <typename T>
    class BufferChannel final : public Channel
    {
    public:
        // Allocates the channel's storage, three buffers of `capacity`
        // elements (at least 1), its maxLength(): not realtime-safe.
        explicit BufferChannel(std::size_t capacity)
            : BufferChannel(std::make_shared<detail::ChannelStorage<T>>(true, std::max<std::size_t>(capacity, 1)))
        {
        }

        [[nodiscard]] std::size_t maxLength() const noexcept { return storage->maxLength; }

        // Realtime-safe (see above): copies `values` and publishes them.
        // false, publishing nothing, when there are more than maxLength().
        bool publish(std::span<const T> values) noexcept
        {
            if (values.size() > storage->maxLength)
                return false;
            if (! values.empty())
                std::memcpy(storage->backData().data(), values.data(), values.size_bytes());
            storage->commit(values.size());
            return true;
        }

        // Realtime-safe, without a copy: the maxLength() elements to write the
        // next value into, in place, then commit() its first `length` of. Its
        // contents before writing are an older value's, or zeros; it is the
        // producer's until commit(), and another one after.
        [[nodiscard]] std::span<T> buffer() noexcept { return storage->backData(); }

        // Publishes the first `length` elements of buffer() (at most
        // maxLength()).
        void commit(std::size_t length) noexcept { storage->commit(length); }

    private:
        explicit BufferChannel(std::shared_ptr<detail::ChannelStorage<T>> made) : Channel(made), storage(made.get()) {}

        detail::ChannelStorage<T>* storage;
    };

    // On the context's UI thread: gives its JavaScript the newest value of
    // every connected channel that has one it has not received. Returns how
    // many values it delivered.
    std::size_t deliverChannels(Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
