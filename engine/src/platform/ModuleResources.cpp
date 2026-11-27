#include "ModuleResources.h"

#include <mutex>
#include <ranges>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        struct Registry
        {
            std::mutex mutex;
            std::vector<std::function<void()>> releases;
        };

        Registry& registry()
        {
            // Never destroyed: see releaseWithModule().
            static auto* const shared = new Registry(); // NOLINT(cppcoreguidelines-owning-memory)
            return *shared;
        }
    } // namespace

    void releaseWithModule(std::function<void()> release)
    {
        Registry& shared = registry();
        const std::scoped_lock lock(shared.mutex);
        shared.releases.push_back(std::move(release));
    }

    void releaseModuleResources()
    {
        Registry& shared = registry();
        std::vector<std::function<void()>> releases;
        {
            const std::scoped_lock lock(shared.mutex);
            releases.swap(shared.releases);
        }
        // Outside the lock: a release waits for its threads to end, and
        // what they run may make something again, which registers.
        for (const auto& release : std::views::reverse(releases))
            release();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
