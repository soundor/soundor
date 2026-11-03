#include "FixtureNative.h"

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#include <windows.h>

namespace soundor::fixtures
{
    struct NativeChild
    {
        HWND window = nullptr;
        std::function<void()> tick;
    };

    namespace
    {
        constexpr UINT_PTR timerId = 1;

        LRESULT CALLBACK childProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
        {
            if (message == WM_TIMER && wParam == timerId)
            {
                if (auto* child = reinterpret_cast<NativeChild*>(GetWindowLongPtrW(window, GWLP_USERDATA)))
                    child->tick();
                return 0;
            }
            return DefWindowProcW(window, message, wParam, lParam);
        }

        HINSTANCE moduleInstance()
        {
            HMODULE module = nullptr;
            GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                               reinterpret_cast<LPCWSTR>(&childProc), &module);
            return module;
        }
    } // namespace

    const char* platformType()
    {
        return Steinberg::kPlatformTypeHWND;
    }

    NativeChild* createChild(void* parent, int width, int height, Steinberg::IPlugFrame* /*frame*/,
                             std::function<void()> tick)
    {
        static const ATOM windowClass = []
        {
            WNDCLASSEXW description {};
            description.cbSize = sizeof description;
            description.lpfnWndProc = &childProc;
            description.hInstance = moduleInstance();
            description.hbrBackground = CreateSolidBrush(RGB(0x2a, 0x6f, 0x97));
            description.lpszClassName = L"SoundorVst3HostFixtureView";
            return RegisterClassExW(&description);
        }();
        auto* child = new NativeChild;
        child->tick = std::move(tick);
        child->window = CreateWindowExW(0, MAKEINTATOM(windowClass), L"", WS_CHILD | WS_VISIBLE, 0, 0, width, height,
                                        static_cast<HWND>(parent), nullptr, moduleInstance(), nullptr);
        SetWindowLongPtrW(child->window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(child));
        SetTimer(child->window, timerId, 10, nullptr);
        return child;
    }

    void resizeChild(NativeChild* child, int width, int height)
    {
        SetWindowPos(child->window, nullptr, 0, 0, width, height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOMOVE);
    }

    void destroyChild(NativeChild* child)
    {
        KillTimer(child->window, timerId);
        SetWindowLongPtrW(child->window, GWLP_USERDATA, 0);
        DestroyWindow(child->window);
        delete child;
    }
} // namespace soundor::fixtures
