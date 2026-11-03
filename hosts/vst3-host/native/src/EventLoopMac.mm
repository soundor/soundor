#include "EventLoop.h"

#import <Cocoa/Cocoa.h>

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
                        if (ui_)
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

        private:
            bool ui_;
            bool running_ = false;
            CFRunLoopTimerRef keepAlive_ = nullptr;
        };
    } // namespace

    std::unique_ptr<EventLoop> EventLoop::create(bool ui)
    {
        return std::make_unique<MacEventLoop>(ui);
    }
} // namespace soundor::vst3host
