#include <soundor/input/Platform.h>

#if defined(__linux__) && ! defined(__ANDROID__)
    #include "input/linux/X11Input.h"
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    std::unique_ptr<PlatformInput> createPlatformInput(const PlatformOptions& options, std::string* failure)
    {
#if defined(__linux__) && ! defined(__ANDROID__)
        return x11::createInput(options, failure);
#else
        // macOS and Windows: the framework's input (JUCE) for now.
        if (failure != nullptr)
            *failure = "no native input on this platform";
        static_cast<void>(options);
        return nullptr;
#endif
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
