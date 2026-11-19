#include "Log.h"

#include <cstdio>
#include <mutex>

namespace soundor::vst3
{
    void log(std::string_view message) noexcept
    {
        static std::mutex lock;
        const std::lock_guard guard(lock);
        std::fprintf(stderr, "%.*s\n", static_cast<int>(message.size()), message.data());
        std::fflush(stderr);
    }
} // namespace soundor::vst3
