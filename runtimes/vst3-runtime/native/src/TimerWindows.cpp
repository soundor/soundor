#include "Log.h"
#include "Timer.h"

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
// After windows.h, which it needs.
#include <commctrl.h>

#include <exception>
#include <stdexcept>
#include <string>
#include <utility>

namespace soundor::vst3
{
    namespace
    {
        constexpr UINT_PTR timerId = 1;
        constexpr UINT_PTR subclassId = 0x53565433; // "SVT3"

        // A message-only window of the system's STATIC class: nothing is
        // registered with the system.
        class WindowsTimer final : public Timer
        {
        public:
            WindowsTimer(int milliseconds, std::function<void()> callback) : fired(std::move(callback))
            {
                window = CreateWindowExW(0, L"STATIC", L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr,
                                         GetModuleHandleW(nullptr), nullptr);
                if (window == nullptr)
                    throw std::runtime_error("could not create a timer window (" + std::to_string(GetLastError())
                                             + ")");
                SetWindowSubclass(window, &windowProc, subclassId, reinterpret_cast<DWORD_PTR>(this));
                SetTimer(window, timerId, static_cast<UINT>(milliseconds), nullptr);
            }

            ~WindowsTimer() override
            {
                KillTimer(window, timerId);
                RemoveWindowSubclass(window, &windowProc, subclassId);
                DestroyWindow(window);
            }
            WindowsTimer(const WindowsTimer&) = delete;
            WindowsTimer& operator=(const WindowsTimer&) = delete;
            WindowsTimer(WindowsTimer&&) = delete;
            WindowsTimer& operator=(WindowsTimer&&) = delete;

        private:
            static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                                               DWORD_PTR data)
            {
                if (message == WM_TIMER && wParam == timerId)
                {
                    try
                    {
                        reinterpret_cast<WindowsTimer*>(data)->fired();
                    }
                    catch (const std::exception& error)
                    {
                        log(std::string("Soundor: a timer failed: ") + error.what());
                    }
                    return 0;
                }
                return DefSubclassProc(hwnd, message, wParam, lParam);
            }

            std::function<void()> fired;
            HWND window = nullptr;
        };
    } // namespace

    std::unique_ptr<Timer> Timer::create(int milliseconds, std::function<void()> callback)
    {
        return std::make_unique<WindowsTimer>(milliseconds, std::move(callback));
    }
} // namespace soundor::vst3
