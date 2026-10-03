#pragma once

#include <soundor/Config.h>

#include <cstddef>
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

        [[nodiscard]] MemoryUsage memoryUsage() const;

    private:
        friend class Context;
        friend detail::RuntimeState& stateOf(Runtime&);

        std::shared_ptr<detail::RuntimeState> state;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
