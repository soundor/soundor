// The fixtures' editor content: a plain native child window (X11, NSView,
// HWND) and a timer driven the way the platform's plugins are driven (the
// host's IRunLoop on Linux, the main run loop or message loop elsewhere).
#pragma once

#include "pluginterfaces/gui/iplugview.h"

#include <functional>

namespace soundor::fixtures
{
    struct NativeChild;

    const char* platformType();
    /** nullptr if the child cannot be created. `tick` runs about every 10 ms
        on the main thread until destroyChild. */
    NativeChild* createChild(void* parent, int width, int height, Steinberg::IPlugFrame* frame,
                             std::function<void()> tick);
    void resizeChild(NativeChild* child, int width, int height);
    void destroyChild(NativeChild* child);
} // namespace soundor::fixtures
