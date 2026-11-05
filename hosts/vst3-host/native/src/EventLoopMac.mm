#include "EventLoop.h"

#import <Cocoa/Cocoa.h>

#include <algorithm>
#include <map>
#include <memory>

namespace soundor::vst3host
{
    namespace
    {
        // Work is posted to the main dispatch queue, which the main run loop
        // drains in both modes. Headless mode never touches NSApplication.
        class MacEventLoop final : public EventLoop
        {
        public:
            explicit MacEventLoop(bool ui) : ui_(ui)
            {
                if (ui_)
                {
                    [NSApplication sharedApplication];
                    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
                    [NSApp finishLaunching];
                }
                else
                {
                    // A run loop without a source returns at once; this timer
                    // keeps CFRunLoopRunInMode waiting for posted work.
                    keepAlive_ = CFRunLoopTimerCreate(
                        nullptr, CFAbsoluteTimeGetCurrent() + 1e9, 1e9, 0, 0, [](CFRunLoopTimerRef, void*) {}, nullptr);
                    CFRunLoopAddTimer(CFRunLoopGetMain(), keepAlive_, kCFRunLoopCommonModes);
                }
            }

            ~MacEventLoop() override
            {
                for (auto& [id, timer] : timers_)
                {
                    CFRunLoopTimerInvalidate(timer->timer);
                    CFRelease(timer->timer);
                }
                if (keepAlive_ != nullptr)
                {
                    CFRunLoopTimerInvalidate(keepAlive_);
                    CFRelease(keepAlive_);
                }
            }

            void run() override
            {
                running_ = true;
                while (running_)
                {
                    @autoreleasepool
                    {
                        if (ui_ && waiter_)
                        {
                            const auto wait = waiter_;
                            wait(0.25);
                        }
                        else if (ui_)
                        {
                            NSEvent* event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                                                untilDate:[NSDate dateWithTimeIntervalSinceNow:0.25]
                                                                   inMode:NSDefaultRunLoopMode
                                                                  dequeue:YES];
                            if (event != nil)
                            {
                                [NSApp sendEvent:event];
                                [NSApp updateWindows];
                            }
                        }
                        else
                            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.25, true);
                    }
                }
            }

            void quit() override { running_ = false; }

            void post(std::function<void()> task) override
            {
                auto* heap = new std::function<void()>(std::move(task));
                dispatch_async(dispatch_get_main_queue(), ^{
                  (*heap)();
                  delete heap;
                });
                CFRunLoopWakeUp(CFRunLoopGetMain());
            }

            Id addTimer(unsigned milliseconds, std::function<void()> fire) override
            {
                const Id id = ++nextId_;
                auto timer = std::make_unique<Timer>();
                timer->fire = std::move(fire);
                const double interval = std::max(1U, milliseconds) / 1000.0;
                CFRunLoopTimerContext context {};
                context.info = timer.get();
                timer->timer = CFRunLoopTimerCreate(
                    nullptr, CFAbsoluteTimeGetCurrent() + interval, interval, 0, 0,
                    [](CFRunLoopTimerRef, void* info)
                    {
                        // A copy: the callback may remove this timer.
                        const auto fire = static_cast<Timer*>(info)->fire;
                        fire();
                    },
                    &context);
                CFRunLoopAddTimer(CFRunLoopGetMain(), timer->timer, kCFRunLoopCommonModes);
                timers_.emplace(id, std::move(timer));
                return id;
            }

            void removeTimer(Id id) override
            {
                const auto it = timers_.find(id);
                if (it == timers_.end())
                    return;
                CFRunLoopTimerInvalidate(it->second->timer);
                CFRelease(it->second->timer);
                timers_.erase(it);
            }

            void setWaiter(std::function<void(double seconds)> wait) override { waiter_ = std::move(wait); }

        private:
            struct Timer
            {
                CFRunLoopTimerRef timer = nullptr;
                std::function<void()> fire;
            };

            bool ui_;
            std::function<void(double seconds)> waiter_;
            std::map<Id, std::unique_ptr<Timer>> timers_;
            Id nextId_ = 0;
            bool running_ = false;
            CFRunLoopTimerRef keepAlive_ = nullptr;
        };
    } // namespace

    std::unique_ptr<EventLoop> EventLoop::create(bool ui)
    {
        return std::make_unique<MacEventLoop>(ui);
    }
} // namespace soundor::vst3host
