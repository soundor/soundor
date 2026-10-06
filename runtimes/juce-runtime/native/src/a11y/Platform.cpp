#include <soundor/a11y/Platform.h>

#if defined(__APPLE__)
    #include <TargetConditionals.h>
#endif
#if SOUNDOR_HAS_ACCESSKIT
    #include "a11y/accesskit/AccessKitPlatform.h"
#elif defined(__APPLE__) && TARGET_OS_OSX
    #include "a11y/apple/MacPlatform.h"
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    std::unique_ptr<PlatformAccessibility> createPlatformAccessibility(const PlatformOptions& options)
    {
#if SOUNDOR_HAS_ACCESSKIT
        return detail::createAccessKitPlatform(options);
#elif defined(__APPLE__) && TARGET_OS_OSX
        return detail::createMacPlatform(options);
#else
        static_cast<void>(options);
        return nullptr;
#endif
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
