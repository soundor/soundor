#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>

#include <chrono>
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
        // Upper bound on each context's JavaScript heap, in bytes. 0 = the
        // engine's default (3 GiB). A context that runs out of heap fails
        // the call that ran out with an "out of memory" InternalError, and
        // every call after it: Hermes cannot go on in that heap, so the
        // context has to be recreated (a reload).
        std::size_t memoryLimit = 0;
        // Stack the interpreter may use for JavaScript frames before throwing
        // a RangeError. Hermes keeps JavaScript frames on a stack of its own
        // and checks the native stack against the thread's real bounds, so
        // this is independent of the UI thread's stack size.
        std::size_t maxStackSize = std::size_t { 512 } * 1024;
        // How long one call into JavaScript may run (a tick, an event, a
        // module's evaluation; see TimeLimitScope). Past it the engine stops
        // the script with a TimeoutError that JavaScript cannot catch, and
        // the context fails that call and every call after it, as when it
        // runs out of heap: it has to be recreated. 0 = no limit.
        std::chrono::milliseconds timeLimit { 0 };
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
        // Garbage collections (young and old generation) in the runtime's
        // contexts.
        std::uint64_t collections = 0;
        // Bytes allocated in the contexts' JavaScript heaps: every object,
        // string and array as it was made, freed or not.
        std::uint64_t allocatedBytes = 0;
        // Memory the heaps hold now: their objects (some of them
        // unreachable until the next collection) and the memory outside the
        // heap that they own (ArrayBuffer data).
        std::uint64_t heapBytes = 0;
    };

    struct MemoryUsage
    {
        std::size_t allocatedBytes = 0;
        std::size_t objectCount = 0;
    };

    // The JavaScript engine (Hermes, interpreted) for a set of contexts: their
    // options, logging and statistics. Each Context is an engine instance of
    // its own, with its own garbage-collected heap and job queue.
    //
    // Threading: a Runtime and every Context created from it belong to the
    // thread that created the Runtime (the plugin's UI/message thread). They must
    // never be touched from another thread, and never from the audio thread.
    //
    // Lifetime: a context's heap is released with the context; the Runtime and
    // its Contexts may be destroyed in any order. Destroying everything and
    // creating a fresh Runtime is the supported way to reload.
    class Runtime
    {
    public:
        explicit Runtime(const RuntimeOptions& options = {});
        ~Runtime();

        Runtime(const Runtime&) = delete;
        Runtime& operator=(const Runtime&) = delete;
        Runtime(Runtime&&) = delete;
        Runtime& operator=(Runtime&&) = delete;

        // Runs every context's queued promise jobs until none is left, then
        // reports promise rejections nobody handled and runs the
        // FinalizationRegistry callbacks of collected objects. Returns how
        // many jobs ran.
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
