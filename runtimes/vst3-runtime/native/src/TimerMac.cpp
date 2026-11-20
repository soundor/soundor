#include "Log.h"
#include "Timer.h"

#include <CoreFoundation/CoreFoundation.h>

#include <exception>
#include <string>
#include <utility>

namespace soundor::vst3
{
    namespace
    {
        class MacTimer final : public Timer
        {
        public:
            MacTimer(int milliseconds, std::function<void()> callback) : fired(std::move(callback))
            {
                CFRunLoopTimerContext context {};
                context.info = this;
                const double interval = static_cast<double>(milliseconds) / 1000.0;
                timer = CFRunLoopTimerCreate(kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + interval, interval, 0, 0,
                                             &fire, &context);
                CFRunLoopAddTimer(CFRunLoopGetMain(), timer, kCFRunLoopCommonModes);
            }

            ~MacTimer() override
            {
                CFRunLoopTimerInvalidate(timer);
                CFRelease(timer);
            }
            MacTimer(const MacTimer&) = delete;
            MacTimer& operator=(const MacTimer&) = delete;
            MacTimer(MacTimer&&) = delete;
            MacTimer& operator=(MacTimer&&) = delete;

        private:
            static void fire(CFRunLoopTimerRef, void* info)
            {
                try
                {
                    static_cast<MacTimer*>(info)->fired();
                }
                catch (const std::exception& error)
                {
                    log(std::string("Soundor: a timer failed: ") + error.what());
                }
            }

            std::function<void()> fired;
            CFRunLoopTimerRef timer = nullptr;
        };
    } // namespace

    std::unique_ptr<Timer> Timer::create(int milliseconds, std::function<void()> callback)
    {
        return std::make_unique<MacTimer>(milliseconds, std::move(callback));
    }
} // namespace soundor::vst3
