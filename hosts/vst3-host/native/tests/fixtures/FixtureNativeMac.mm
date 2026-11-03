#include "FixtureNative.h"

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

namespace soundor::fixtures
{
    struct NativeChild
    {
        NSView* view = nil;
        CFRunLoopTimerRef timer = nullptr;
        std::function<void()> tick;
    };

    const char* platformType()
    {
        return Steinberg::kPlatformTypeNSView;
    }

    NativeChild* createChild(void* parent, int width, int height, Steinberg::IPlugFrame* /*frame*/,
                             std::function<void()> tick)
    {
        auto* child = new NativeChild;
        child->tick = std::move(tick);
        child->view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
        [child->view setWantsLayer:YES];
        [[child->view layer] setBackgroundColor:[[NSColor colorWithRed:0.16 green:0.44 blue:0.59 alpha:1] CGColor]];
        [static_cast<NSView*>(parent) addSubview:child->view];
        CFRunLoopTimerContext context { 0, child, nullptr, nullptr, nullptr };
        child->timer = CFRunLoopTimerCreate(
            nullptr, CFAbsoluteTimeGetCurrent() + 0.01, 0.01, 0, 0,
            [](CFRunLoopTimerRef, void* info) { static_cast<NativeChild*>(info)->tick(); }, &context);
        CFRunLoopAddTimer(CFRunLoopGetMain(), child->timer, kCFRunLoopCommonModes);
        return child;
    }

    void resizeChild(NativeChild* child, int width, int height)
    {
        [child->view setFrame:NSMakeRect(0, 0, width, height)];
    }

    void destroyChild(NativeChild* child)
    {
        CFRunLoopTimerInvalidate(child->timer);
        CFRelease(child->timer);
        [child->view removeFromSuperview];
        [child->view release];
        delete child;
    }
} // namespace soundor::fixtures
