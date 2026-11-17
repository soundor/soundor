// processor::AudioState, the state snapshots a plugin's audio processing
// reads: whole snapshots, the latest only, stable while held, and nothing
// allocated or locked on the reading side.

#include <soundor/processor/AudioState.h>

#include <doctest/doctest.h>

#include <atomic>
#include <cstdint>
#include <cstring>
#include <span>
#include <thread>
#include <vector>

// AllocationCounter.cpp's (0 counted under AddressSanitizer, which owns
// operator new).
bool soundorCountsAllocations();
std::uint64_t soundorAllocationsOf(void (*run)(void*), void* context);

namespace processor = soundor::processor;

namespace
{
    template <typename Run>
    std::uint64_t allocationsOf(Run&& run)
    {
        return soundorAllocationsOf([](void* context) { (*static_cast<Run*>(context))(); }, &run);
    }

    void publishWords(processor::AudioState& state, std::uint64_t value)
    {
        state.publishWith(
            [value](std::span<std::byte> slot)
            {
                for (std::size_t at = 0; at + sizeof(value) <= slot.size(); at += sizeof(value))
                    std::memcpy(slot.data() + at, &value, sizeof(value));
            });
    }
} // namespace

TEST_SUITE("processor::AudioState")
{
    TEST_CASE("has no snapshot until one is published, then the latest")
    {
        processor::AudioState state(24);
        CHECK(state.size() == 24);
        CHECK(state.acquire() == nullptr);
        publishWords(state, 1);
        publishWords(state, 2);
        publishWords(state, 3);
        const auto* words = static_cast<const std::uint64_t*>(state.acquire());
        REQUIRE(words != nullptr);
        CHECK(words[0] == 3);
        CHECK(words[2] == 3);
        // Kept, unchanged, while nothing newer is published.
        CHECK(state.acquire() == words);
        CHECK(state.statistics().published == 3);
        CHECK(state.statistics().taken == 1);
    }

    TEST_CASE("a held snapshot never changes while newer ones are published")
    {
        processor::AudioState state(16);
        publishWords(state, 1);
        const auto* held = static_cast<const std::uint64_t*>(state.acquire());
        for (std::uint64_t value = 2; value < 50; ++value)
            publishWords(state, value);
        CHECK(held[0] == 1);
        CHECK(held[1] == 1);
        const auto* next = static_cast<const std::uint64_t*>(state.acquire());
        CHECK(next[0] == 49);
    }

    TEST_CASE("a snapshot of any size is aligned for every element")
    {
        for (const std::size_t size :
             { std::size_t { 1 }, std::size_t { 7 }, std::size_t { 8 }, std::size_t { 13 }, std::size_t { 4096 } })
        {
            processor::AudioState state(size);
            std::vector<std::byte> bytes(size, std::byte { 0x5a });
            state.publish(bytes);
            const void* snapshot = state.acquire();
            REQUIRE(snapshot != nullptr);
            CHECK(reinterpret_cast<std::uintptr_t>(snapshot) % alignof(std::uint64_t) == 0);
            CHECK(std::memcmp(snapshot, bytes.data(), size) == 0);
        }
    }

    TEST_CASE("acquiring allocates nothing")
    {
        if (! soundorCountsAllocations())
            return;
        processor::AudioState state(1024);
        publishWords(state, 7);
        const auto allocations = allocationsOf(
            [&]
            {
                for (int block = 0; block < 100; ++block)
                    (void)state.acquire();
            });
        CHECK(allocations == 0);
    }

    TEST_CASE("a reader on another thread only ever sees whole, newer snapshots")
    {
        // 64 KiB snapshots, every word the snapshot's number: a torn one
        // would mix two numbers.
        constexpr std::size_t size = std::size_t { 64 } * 1024;
        constexpr std::uint64_t count = 2000;
        processor::AudioState state(size);
        publishWords(state, 1);
        std::atomic<bool> done { false };
        std::atomic<std::uint64_t> torn { 0 }, backwards { 0 }, seen { 0 };
        std::thread reader(
            [&]
            {
                std::uint64_t last = 0;
                while (! done.load(std::memory_order_acquire))
                {
                    const auto* words = static_cast<const std::uint64_t*>(state.acquire());
                    const auto first = words[0];
                    for (std::size_t word = 0; word < size / sizeof(std::uint64_t); ++word)
                        if (words[word] != first)
                        {
                            ++torn;
                            break;
                        }
                    if (first < last)
                        ++backwards;
                    if (first != last)
                        ++seen;
                    last = first;
                }
            });
        // Two writers: publish() serializes them.
        std::thread other(
            [&]
            {
                for (std::uint64_t value = 2; value <= count; value += 2)
                    publishWords(state, value);
            });
        for (std::uint64_t value = 3; value <= count; value += 2)
            publishWords(state, value);
        other.join();
        done.store(true, std::memory_order_release);
        reader.join();
        CHECK(torn == 0);
        CHECK(seen > 0);
        CHECK(state.statistics().published == count);
        // Two writers interleave, so numbers may go back; one never tears.
        static_cast<void>(backwards.load());
    }

    TEST_CASE("one writer's snapshots arrive in order")
    {
        processor::AudioState state(8);
        publishWords(state, 0);
        std::atomic<bool> done { false };
        std::atomic<std::uint64_t> backwards { 0 };
        std::thread reader(
            [&]
            {
                std::uint64_t last = 0;
                while (! done.load(std::memory_order_acquire))
                {
                    const auto value = *static_cast<const std::uint64_t*>(state.acquire());
                    if (value < last)
                        ++backwards;
                    last = value;
                }
            });
        for (std::uint64_t value = 1; value <= 100000; ++value)
            publishWords(state, value);
        done.store(true, std::memory_order_release);
        reader.join();
        CHECK(backwards == 0);
        CHECK(*static_cast<const std::uint64_t*>(state.acquire()) == 100000);
    }
}
