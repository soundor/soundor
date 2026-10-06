#include <soundor/a11y/Platform.h>

#if SOUNDOR_HAS_ACCESSKIT
    #include "a11y/accesskit/AccessKitPlatform.h"
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    std::unique_ptr<PlatformAccessibility> createPlatformAccessibility(const PlatformOptions& options)
    {
#if SOUNDOR_HAS_ACCESSKIT
        return detail::createAccessKitPlatform(options);
#else
        static_cast<void>(options);
        return nullptr;
#endif
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
