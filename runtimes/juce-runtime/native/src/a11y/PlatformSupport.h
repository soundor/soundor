#pragma once

// What every platform adapter needs to live safely in a host process: a way
// for platform callbacks to find the adapter without holding a pointer to it,
// and a way to stay loaded once the platform may call into this binary.

#include <soundor/Config.h>

#include <cstdint>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    // Shared state platform callbacks reach by token. Tokens are never
    // reused; a callback whose state has gone finds nothing.
    template <typename State>
    class Registry
    {
    public:
        // Never destroyed: a platform thread may call back while the process
        // exits.
        static Registry& instance()
        {
            static auto* registry = new Registry; // NOLINT(cppcoreguidelines-owning-memory)
            return *registry;
        }

        std::uintptr_t enroll(const std::shared_ptr<State>& state)
        {
            const std::scoped_lock lock(mutex);
            states.emplace(++last, state);
            return last;
        }

        void withdraw(std::uintptr_t token)
        {
            const std::scoped_lock lock(mutex);
            states.erase(token);
        }

        std::shared_ptr<State> find(std::uintptr_t token)
        {
            const std::scoped_lock lock(mutex);
            const auto found = states.find(token);
            return found == states.end() ? nullptr : found->second.lock();
        }

    private:
        Registry() = default;

        std::mutex mutex;
        std::unordered_map<std::uintptr_t, std::weak_ptr<State>> states;
        std::uintptr_t last = 0;
    };

    // Keeps this binary (the plugin) loaded for the rest of the process. For
    // when the platform holds on to code in it (Objective-C classes, COM
    // objects, threads) longer than Soundor can know.
    void pinModule();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
