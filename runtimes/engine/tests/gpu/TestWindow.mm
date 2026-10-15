#include "TestWindow.h"

#import <AppKit/AppKit.h>

namespace soundor::test
{
    void* createTestWindow(int width, int height)
    {
        [NSApplication sharedApplication];
        NSWindow* window = [[NSWindow alloc] initWithContentRect:NSMakeRect(100, 100, width, height)
                                                       styleMask:NSWindowStyleMaskBorderless
                                                         backing:NSBackingStoreBuffered
                                                           defer:NO];
        window.releasedWhenClosed = NO;
        NSView* view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
        [window setContentView:view];
        [window orderFront:nil];
        // The window keeps itself alive until destroyTestWindow().
        return (__bridge_retained void*)view;
    }

    void destroyTestWindow(void* handle)
    {
        NSView* view = (__bridge_transfer NSView*)handle;
        [view.window close];
    }
} // namespace soundor::test
