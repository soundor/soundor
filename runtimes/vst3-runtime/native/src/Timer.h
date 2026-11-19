#pragma once

// A timer on the UI thread's run loop, where the host lends none: macOS (the
// main run loop, in its common modes, so it fires while a menu tracks or a
// window resizes) and Windows (a message-only window of the thread that
// created it). Linux hosts lend theirs (Linux::IRunLoop).

#include <functional>
#include <memory>

namespace soundor::vst3
{
    class Timer
    {
    public:
        // Calls `callback` every `milliseconds`, from the run loop of the
        // thread that created it (the host's UI thread), until destroyed.
        [[nodiscard]] static std::unique_ptr<Timer> create(int milliseconds, std::function<void()> callback);

        Timer() = default;
        virtual ~Timer() = default;
        Timer(const Timer&) = delete;
        Timer& operator=(const Timer&) = delete;
        Timer(Timer&&) = delete;
        Timer& operator=(Timer&&) = delete;
    };
} // namespace soundor::vst3
