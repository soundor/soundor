#include "TestWindow.h"

#if defined(_WIN32)
    #define NOMINMAX
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
#elif defined(__linux__)
    #include <X11/Xlib.h>

    #include <cstdint>
    #include <memory>
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
#elif defined(__linux__)
    namespace
    {
        Display* testDisplay()
        {
            // Keep one client connected between tests. Xvfb otherwise resets
            // when its last client exits and can reject the next connection.
            static const std::unique_ptr<Display, decltype(&XCloseDisplay)> display(XOpenDisplay(nullptr),
                                                                                    XCloseDisplay);
            return display.get();
        }
    } // namespace

    void* createTestWindow(int width, int height)
    {
        Display* display = testDisplay();
        if (display == nullptr)
            return nullptr;
        const Window window = XCreateSimpleWindow(display, DefaultRootWindow(display), 0, 0,
                                                  static_cast<unsigned>(width), static_cast<unsigned>(height), 0, 0, 0);
        XMapWindow(display, window);
        XSync(display, False);
        const auto id = static_cast<std::uintptr_t>(window);
        return reinterpret_cast<void*>(id); // NOLINT(performance-no-int-to-ptr)
    }

    void destroyTestWindow(void* view)
    {
        const auto window = static_cast<Window>(reinterpret_cast<std::uintptr_t>(view));
        if (Display* display = testDisplay())
        {
            XDestroyWindow(display, window);
            XSync(display, False);
        }
    }
#else
    void* createTestWindow(int, int)
    {
        return nullptr;
    }

    void destroyTestWindow(void*) {}
#endif
} // namespace soundor::test
