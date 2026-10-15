#pragma once

// Soundor's additions to Hermes's JSI API: what Soundor's bindings need and
// JSI either lacks or answers slowly (through property lookups). Compiled
// into Hermes's own API/hermes/hermes.cpp (SoundorHermes.inc, appended by
// SoundorHermesPatch.cmake), where the engine's values are reachable; every
// function takes the HermesRuntime that `runtime` is.
//
// Nothing here allocates on the JavaScript heap, calls JavaScript or throws.

#include <jsi/jsi.h>

#include <cstddef>
#include <cstdint>

namespace facebook::hermes::soundor
{
    // The element type of a typed array; None for an ArrayBuffer.
    enum class TypedArrayKind : std::int8_t
    {
        None = -1,
        Int8,
        Uint8,
        Uint8Clamped,
        Int16,
        Uint16,
        Int32,
        Uint32,
        Float32,
        Float64,
        BigInt64,
        BigUint64,
    };

    // The bytes an ArrayBuffer or typed array covers: for a typed array, its
    // view (byteOffset and byteLength) into its buffer. Valid until the
    // engine next runs: nothing moves the bytes in between.
    struct BufferView
    {
        TypedArrayKind kind = TypedArrayKind::None;
        // nullptr when the buffer is detached or has no bytes.
        std::uint8_t* data = nullptr;
        std::size_t byteLength = 0;
        bool detached = false;
    };

    // Whether `value` is an ArrayBuffer or a typed array, telling them apart
    // by their internal class (not their prototype); `out` describes it.
    bool bufferView(jsi::Runtime& runtime, const jsi::Value& value, BufferView& out) noexcept;

    // Detaches an ArrayBuffer (as transfer() does): its data is freed and it
    // and its views read as empty. False when `value` is not an ArrayBuffer.
    bool detachArrayBuffer(jsi::Runtime& runtime, const jsi::Value& value) noexcept;

    // Whether promise jobs (microtasks) are queued.
    bool hasPendingJobs(jsi::Runtime& runtime) noexcept;

    // How many jobs have run since the runtime was created.
    std::uint64_t jobsRun(jsi::Runtime& runtime) noexcept;

    struct HeapStatistics
    {
        // Garbage collections since the runtime was created.
        std::uint64_t collections = 0;
        // Bytes allocated in the JavaScript heap since the runtime was
        // created.
        std::uint64_t totalAllocatedBytes = 0;
        // Bytes allocated in the JavaScript heap now (some unreachable).
        std::uint64_t allocatedBytes = 0;
        // The heap's capacity.
        std::uint64_t heapSize = 0;
        // Memory outside the heap that heap objects own (ArrayBuffer data).
        std::uint64_t externalBytes = 0;
    };

    // Counters the collector keeps: cheap, for every frame.
    HeapStatistics heapStatistics(jsi::Runtime& runtime) noexcept;

    // Objects in the heap, counted by walking it: not for every frame.
    std::size_t countObjects(jsi::Runtime& runtime) noexcept;

    // JSI values (jsi::Value, jsi::Object...) that C++ still holds: a runtime
    // must outlive every one of them.
    std::size_t liveValues(jsi::Runtime& runtime) noexcept;
} // namespace facebook::hermes::soundor
