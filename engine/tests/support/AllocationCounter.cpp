// Counts operator new on the threads that ask, for the Rust processor bridge's
// tests (processor/RustProcessorTests.cpp): kept in a file of its own, apart
// from the code it counts.

#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <new>

// ── Allocations, counted on the thread that asks ────────────────────────────
//
// The bridge runs in the audio callback: it must not call the allocator
// there. Counted by replacing the global operator new, which
// AddressSanitizer replaces itself: under it nothing is counted. The Rust
// side's allocations are counted by the SDK's own tests (CountingAllocator).

#if defined(__SANITIZE_ADDRESS__)
    #define SOUNDOR_COUNT_ALLOCATIONS 0
#elif defined(__has_feature)
    #if __has_feature(address_sanitizer)
        #define SOUNDOR_COUNT_ALLOCATIONS 0
    #endif
#endif
#ifndef SOUNDOR_COUNT_ALLOCATIONS
    #define SOUNDOR_COUNT_ALLOCATIONS 1
#endif

namespace
{
    thread_local bool countAllocations = false;
    std::atomic<std::uint64_t> counted { 0 };

} // namespace

#if SOUNDOR_COUNT_ALLOCATIONS
void* operator new(std::size_t size)
{
    if (countAllocations)
        counted.fetch_add(1, std::memory_order_relaxed);
    if (void* memory = std::malloc(size == 0 ? 1 : size))
        return memory;
    throw std::bad_alloc();
}

void operator delete(void* memory) noexcept
{
    std::free(memory);
}

void operator delete(void* memory, std::size_t) noexcept
{
    std::free(memory);
}

void* operator new[](std::size_t size)
{
    return operator new(size);
}

void operator delete[](void* memory) noexcept
{
    std::free(memory);
}

void operator delete[](void* memory, std::size_t) noexcept
{
    std::free(memory);
}

void* operator new(std::size_t size, const std::nothrow_t&) noexcept
{
    if (countAllocations)
        counted.fetch_add(1, std::memory_order_relaxed);
    return std::malloc(size == 0 ? 1 : size);
}

void* operator new[](std::size_t size, const std::nothrow_t& tag) noexcept
{
    return operator new(size, tag);
}

void operator delete(void* memory, const std::nothrow_t&) noexcept
{
    std::free(memory);
}

void operator delete[](void* memory, const std::nothrow_t&) noexcept
{
    std::free(memory);
}
#endif

bool soundorCountsAllocations()
{
    return SOUNDOR_COUNT_ALLOCATIONS != 0;
}

std::uint64_t soundorAllocationsOf(void (*run)(void*), void* context)
{
    const auto before = counted.load();
    countAllocations = true;
    run(context);
    countAllocations = false;
    return counted.load() - before;
}
