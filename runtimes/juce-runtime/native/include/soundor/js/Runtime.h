#pragma once

#include <soundor/Config.h>

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        struct RuntimeState;
    }

    enum class LogLevel
    {
        Debug,
        Info,
        Warn,
        Error,
    };

    // Receives diagnostics the runtime cannot report as a return value, such as
    // unhandled promise rejections. Called on the runtime's owning thread.
    using LogSink = std::function<void(LogLevel, std::string_view message)>;

    struct RuntimeOptions
    {
        // Upper bound on JavaScript heap allocations, in bytes. 0 = unlimited.
        std::size_t memoryLimit = 0;

        // Native stack the engine may use before throwing a RangeError instead
        // of overflowing. Kept well below the smallest UI-thread stack a plugin
        // host is likely to provide (1 MiB on Windows).
        std::size_t maxStackSize = std::size_t { 512 } * 1024;

        // Where diagnostics go. Without a sink they are dropped.
        LogSink log;
        // Whether native calls are timed as well as counted (see
        // RuntimeStatistics): a clock read on entry and exit of each call,
        // for profiling.
        bool timeNativeCalls = false;
    };

    // Calls from JavaScript into one of Soundor's native APIs.
    struct NativeCallStatistics
    {
        std::uint64_t calls = 0;
        // Time spent in the outermost of nested calls (RuntimeOptions::
        // timeNativeCalls), so nothing is counted twice.
        std::uint64_t nanoseconds = 0;
    };

    // What the engine did since the runtime was created; counting is always
    // on and costs an increment. Take differences for a frame or a phase.
    struct RuntimeStatistics
    {
        NativeCallStatistics ui;     // soundor:ui (nodes, styles, text, events)
        NativeCallStatistics canvas; // Canvas 2D
        NativeCallStatistics webgl;  // WebGL
        // Memory the engine took from the C allocator (reallocations
        // included), and its bytes. The engine serves blocks of up to 512
        // bytes from arenas of its own, so these are its arenas and every
        // larger block: typed arrays, arrays' storage, long strings.
        std::uint64_t allocations = 0;
        std::uint64_t allocatedBytes = 0;
        // Memory the engine holds now (its arenas included).
        std::uint64_t heapBytes = 0;
    };

    struct MemoryUsage
    {
        std::size_t allocatedBytes = 0;
        std::size_t objectCount = 0;
    };

    // One JavaScript engine instance: a garbage-collected heap and a job queue.
    //
    // Threading: a Runtime and every Context created from it belong to the
    // thread that created the Runtime (the plugin's UI/message thread). They must
    // never be touched from another thread, and never from the audio thread.
    //
    // Lifetime: the engine heap is released once the Runtime and all of its
    // Contexts are destroyed, in any order. Destroying everything and creating a
    // fresh Runtime is the supported way to reload.
    class Runtime
    {
    public:
        explicit Runtime(const RuntimeOptions& options = {});
        ~Runtime();

        Runtime(const Runtime&) = delete;
        Runtime& operator=(const Runtime&) = delete;
        Runtime(Runtime&&) = delete;
        Runtime& operator=(Runtime&&) = delete;

        // Runs queued promise jobs until the queue is empty, then reports
        // promise rejections nobody handled. Returns how many jobs ran.
        std::size_t runPendingJobs();

        [[nodiscard]] bool hasPendingJobs() const;

        void collectGarbage();

        // Walks the whole heap: not for every frame (see statistics()).
        [[nodiscard]] MemoryUsage memoryUsage() const;
        [[nodiscard]] const RuntimeStatistics& statistics() const noexcept;

    private:
        friend class Context;
        friend detail::RuntimeState& stateOf(Runtime&);

        std::shared_ptr<detail::RuntimeState> state;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
