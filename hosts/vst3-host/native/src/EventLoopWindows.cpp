#include "EventLoop.h"

#include <deque>
#include <mutex>

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#include <windows.h>

namespace soundor::vst3host
{
    namespace
    {
        constexpr UINT runTasksMessage = WM_APP + 1;

        // Posted work goes through a message-only window rather than thread
        // messages, which modal loops (a window being dragged or resized)
        // would drop. Headless mode creates nothing visible.
        class WindowsEventLoop final : public EventLoop
        {
        public:
            WindowsEventLoop()
            {
                WNDCLASSEXW windowClass {};
                windowClass.cbSize = sizeof windowClass;
                windowClass.lpfnWndProc = &WindowsEventLoop::windowProc;
                windowClass.hInstance = GetModuleHandleW(nullptr);
                windowClass.lpszClassName = L"SoundorVst3HostMessages";
                RegisterClassExW(&windowClass);
                window_ = CreateWindowExW(0, windowClass.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr,
                                          windowClass.hInstance, nullptr);
                SetWindowLongPtrW(window_, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
            }

            ~WindowsEventLoop() override
            {
                if (window_ != nullptr)
                    DestroyWindow(window_);
            }

            void run() override
            {
                running_ = true;
                MSG message {};
                while (running_ && GetMessageW(&message, nullptr, 0, 0) > 0)
                {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }

            void quit() override
            {
                running_ = false;
                PostMessageW(window_, WM_NULL, 0, 0);
            }

            void post(std::function<void()> task) override
            {
                {
                    const std::scoped_lock lock(mutex_);
                    tasks_.push_back(std::move(task));
                }
                PostMessageW(window_, runTasksMessage, 0, 0);
            }

        private:
            static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
            {
                if (message == runTasksMessage)
                {
                    auto* self = reinterpret_cast<WindowsEventLoop*>(GetWindowLongPtrW(window, GWLP_USERDATA));
                    if (self != nullptr)
                        self->runTasks();
                    return 0;
                }
                return DefWindowProcW(window, message, wParam, lParam);
            }

            void runTasks()
            {
                std::deque<std::function<void()>> tasks;
                {
                    const std::scoped_lock lock(mutex_);
                    tasks.swap(tasks_);
                }
                for (auto& task : tasks)
                    task();
            }

            HWND window_ = nullptr;
            bool running_ = false;
            std::mutex mutex_;
            std::deque<std::function<void()>> tasks_;
        };
    } // namespace

    std::unique_ptr<EventLoop> EventLoop::create(bool /*ui*/)
    {
        return std::make_unique<WindowsEventLoop>();
    }
} // namespace soundor::vst3host
