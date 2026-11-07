#include "Internal.h"

#include <jsi/instrumentation.h>

#include <algorithm>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        RuntimeState::RuntimeState(const RuntimeOptions& runtimeOptions)
            : options(runtimeOptions),
              timeNativeCalls(runtimeOptions.timeNativeCalls),
              owner(std::this_thread::get_id())
        {
        }

        RuntimeState::~RuntimeState()
        {
            // Contexts hold their runtime state: none can be left.
            assert(contexts.empty());
        }

        void RuntimeState::log(LogLevel level, std::string_view message) const
        {
            if (options.log)
                options.log(level, message);
        }

        void RuntimeState::refreshStatistics()
        {
            std::uint64_t collections = retiredCollections;
            std::uint64_t allocated = retiredAllocatedBytes;
            std::uint64_t heap = 0;
            for (ContextState* context : contexts)
            {
                const auto heapStatistics = facebook::hermes::soundor::heapStatistics(context->rt);
                collections += heapStatistics.collections;
                allocated += heapStatistics.totalAllocatedBytes;
                heap += heapStatistics.allocatedBytes + heapStatistics.externalBytes;
            }
            statistics.collections = collections;
            statistics.allocatedBytes = allocated;
            statistics.heapBytes = heap;
        }
    } // namespace detail

    detail::RuntimeState& stateOf(Runtime& runtime)
    {
        return *runtime.state;
    }

    Runtime::Runtime(const RuntimeOptions& options) : state(std::make_shared<detail::RuntimeState>(options)) {}

    Runtime::~Runtime()
    {
        state->assertOwnerThread();
    }

    std::size_t Runtime::runPendingJobs()
    {
        state->assertOwnerThread();
        std::size_t count = 0;
        // A job may create or destroy nothing here, but iterate a copy anyway.
        const std::vector<detail::ContextState*> contexts = state->contexts;
        for (detail::ContextState* context : contexts)
            count += context->drainJobs();
        return count;
    }

    bool Runtime::hasPendingJobs() const
    {
        state->assertOwnerThread();
        return std::ranges::any_of(
            state->contexts, [](detail::ContextState* context)
            { return ! context->halted() && facebook::hermes::soundor::hasPendingJobs(context->rt); });
    }

    void Runtime::collectGarbage()
    {
        state->assertOwnerThread();
        for (detail::ContextState* context : state->contexts)
        {
            if (! context->halted())
                context->rt.instrumentation().collectGarbage("soundor");
            context->releaseHandles();
        }
    }

    const RuntimeStatistics& Runtime::statistics() const noexcept
    {
        state->refreshStatistics();
        return state->statistics;
    }

    MemoryUsage Runtime::memoryUsage() const
    {
        state->assertOwnerThread();
        MemoryUsage usage;
        for (detail::ContextState* context : state->contexts)
        {
            const auto heap = facebook::hermes::soundor::heapStatistics(context->rt);
            usage.allocatedBytes += static_cast<std::size_t>(heap.allocatedBytes + heap.externalBytes);
            usage.objectCount += facebook::hermes::soundor::countObjects(context->rt);
        }
        return usage;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
