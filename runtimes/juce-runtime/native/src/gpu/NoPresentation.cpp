#include "gpu/Presentation.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // Linux: presenting from Vulkan into the host's X11 window needs ANGLE
    // built with X11 and xcb, which would link them into every plugin, and a
    // plugin must load without them (a host without a display renders
    // offline). JUCE loads X11 at run time for the same reason. So the
    // picture is composited on the CPU here; the GPU still renders (WebGL)
    // and is read back.
    std::unique_ptr<Presentation> createPresentation(void*, std::string* failure)
    {
        if (failure != nullptr)
            *failure = "no GPU presentation on Linux: it would link X11 into the plugin";
        return nullptr;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
