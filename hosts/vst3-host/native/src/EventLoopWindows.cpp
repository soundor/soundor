#include "EventLoop.h"

#include <algorithm>
#include <deque>
#include <map>
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

            Id addTimer(unsigned milliseconds, std::function<void()> fire) override
            {
                const Id id = ++nextId_;
                timers_.emplace(id, std::move(fire));
                SetTimer(window_, static_cast<UINT_PTR>(id), std::max<UINT>(USER_TIMER_MINIMUM, milliseconds), nullptr);
                return id;
            }

            void removeTimer(Id id) override
            {
                KillTimer(window_, static_cast<UINT_PTR>(id));
                timers_.erase(id);
            }

        private:
            static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
            {
                auto* self = reinterpret_cast<WindowsEventLoop*>(GetWindowLongPtrW(window, GWLP_USERDATA));
                if (message == runTasksMessage)
                {
                    if (self != nullptr)
                        self->runTasks();
                    return 0;
                }
                if (message == WM_TIMER && self != nullptr)
                {
                    const auto it = self->timers_.find(static_cast<Id>(wParam));
                    if (it != self->timers_.end())
                    {
                        // A copy: the callback may remove this timer.
                        const auto fire = it->second;
                        fire();
                    }
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
            std::map<Id, std::function<void()>> timers_;
            Id nextId_ = 0;
        };
    } // namespace

    std::unique_ptr<EventLoop> EventLoop::create(bool /*ui*/)
    {
        return std::make_unique<WindowsEventLoop>();
    }
} // namespace soundor::vst3host
