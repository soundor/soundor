// The main thread's loop. Every SDK call except process() runs on it, as
// VST3 requires of the "UI thread"; other threads hand work to it with post().
//
// Headless mode creates no window and initializes no video backend, but still
// runs this loop: plugins post work to their main thread (dispatch's main
// queue on macOS, window messages on Windows, IRunLoop handlers on Linux).
#pragma once

#include <functional>
#include <memory>

namespace soundor::vst3host
{
    class EventLoop
    {
    public:
        virtual ~EventLoop() = default;

        /** `ui`: the platform's application object is set up for windows
            (NSApplication on macOS); otherwise nothing visual is touched. */
        static std::unique_ptr<EventLoop> create(bool ui);

        /** Runs until quit(). */
        virtual void run() = 0;
        /** Main thread only. */
        virtual void quit() = 0;
        /** Any thread. Tasks run on the main thread, in order. */
        virtual void post(std::function<void()> task) = 0;

#if defined(__linux__)
        // Linux::IRunLoop's primitives (RunLoop.cpp), also used by the X11
        // window for its display connection. Main thread only.
        using Id = unsigned long;
        virtual Id addFd(int fd, std::function<void()> readable) = 0;
        virtual void removeFd(Id id) = 0;
        virtual Id addTimer(unsigned milliseconds, std::function<void()> fire) = 0;
        virtual void removeTimer(Id id) = 0;
#endif
    };
} // namespace soundor::vst3host
