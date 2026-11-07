#include "TestWindow.h"

#if defined(_WIN32)
    #define NOMINMAX
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
#endif

namespace soundor::test
{
#if defined(_WIN32)
    void* createTestWindow(int width, int height)
    {
        // The system's STATIC class: nothing to register.
        HWND window = CreateWindowExW(0, L"STATIC", L"Soundor test", WS_POPUP | WS_VISIBLE, 100, 100, width, height,
                                      nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
        return window;
    }

    void destroyTestWindow(void* view)
    {
        DestroyWindow(static_cast<HWND>(view));
    }
#else
    void* createTestWindow(int, int)
    {
        return nullptr;
    }

    void destroyTestWindow(void*) {}
#endif
} // namespace soundor::test
