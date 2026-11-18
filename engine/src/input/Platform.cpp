#include <soundor/input/Platform.h>

#if defined(__linux__) && ! defined(__ANDROID__)
    #include "input/linux/X11Input.h"
#elif defined(__APPLE__)
    #include <TargetConditionals.h>
    #if TARGET_OS_OSX
        #include "input/apple/MacInput.h"
    #endif
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    std::unique_ptr<PlatformInput> createPlatformInput(const PlatformOptions& options, std::string* failure)
    {
#if defined(__linux__) && ! defined(__ANDROID__)
        return x11::createInput(options, failure);
#elif defined(__APPLE__) && TARGET_OS_OSX
        return apple::createInput(options, failure);
#else
        // Windows and iOS: the framework's input (JUCE) for now.
        if (failure != nullptr)
            *failure = "no native input on this platform";
        static_cast<void>(options);
        return nullptr;
#endif
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
