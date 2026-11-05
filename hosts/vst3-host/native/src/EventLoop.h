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

        using Id = unsigned long;
        /** A repeating timer on the main thread. Main thread only. */
        virtual Id addTimer(unsigned milliseconds, std::function<void()> fire) = 0;
        virtual void removeTimer(Id id) = 0;

#if defined(__APPLE__)
        /** In UI mode, waits for and dispatches Cocoa's events instead of the
            loop's own wait (the host interface's SDL window reads them
            itself); nullptr goes back to the loop's. */
        virtual void setWaiter(std::function<void(double seconds)> wait) = 0;
#endif

#if defined(__linux__)
        // With the timers, Linux::IRunLoop's primitives (HostContext.cpp),
        // also used by the X11 windows for their display connections. Main
        // thread only.
        virtual Id addFd(int fd, std::function<void()> readable) = 0;
        virtual void removeFd(Id id) = 0;
#endif
    };
} // namespace soundor::vst3host
