// An NSWindow whose content view hosts the editor. Notifications arrive
// through block observers: the host registers no Objective-C classes.
#include "EditorWindow.h"

#import <Cocoa/Cocoa.h>

#include <vector>

namespace soundor::vst3host
{
    namespace
    {
        class MacEditorWindow final : public EditorWindow
        {
        public:
            MacEditorWindow(EventLoop& loop, const std::string& title, int width, int height, Callbacks callbacks)
                : loop_(loop), callbacks_(std::move(callbacks))
            {
                const NSRect frame = NSMakeRect(0, 0, width, height);
                window_ =
                    [[NSWindow alloc] initWithContentRect:frame
                                                styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                                                          | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                                  backing:NSBackingStoreBuffered
                                                    defer:NO];
                [window_ setReleasedWhenClosed:NO];
                [window_ setTitle:[NSString stringWithUTF8String:title.c_str()]];
                content_ = [[NSView alloc] initWithFrame:frame];
                [window_ setContentView:content_];
                [window_ center];

                NSNotificationCenter* center = [NSNotificationCenter defaultCenter];
                auto observe = [&](NSNotificationName name, void (^block)(NSNotification*)) {
                    observers_.push_back([[center addObserverForName:name object:window_ queue:nil
                                                          usingBlock:block] retain]);
                };
                observe(NSWindowDidResizeNotification, ^(NSNotification*) {
                  if (ignoreResize_ || ! callbacks_.resized)
                      return;
                  const NSSize size = [content_ frame].size;
                  callbacks_.resized(static_cast<int>(size.width), static_cast<int>(size.height));
                });
                observe(NSWindowDidBecomeKeyNotification, ^(NSNotification*) {
                  if (callbacks_.focusChanged)
                      callbacks_.focusChanged(true);
                });
                observe(NSWindowDidResignKeyNotification, ^(NSNotification*) {
                  if (callbacks_.focusChanged)
                      callbacks_.focusChanged(false);
                });
                observe(NSWindowWillCloseNotification, ^(NSNotification*) {
                  if (closing_ || ! callbacks_.closed)
                      return;
                  // The callback destroys this window.
                  loop_.post(callbacks_.closed);
                });
            }

            ~MacEditorWindow() override
            {
                closing_ = true;
                for (id observer : observers_)
                {
                    [[NSNotificationCenter defaultCenter] removeObserver:observer];
                    [observer release];
                }
                [window_ orderOut:nil];
                [window_ close];
                [content_ release];
                [window_ release];
            }

            [[nodiscard]] const char* platformType() const override { return "NSView"; }
            [[nodiscard]] void* parentHandle() const override { return static_cast<void*>(content_); }

            void setResizable(bool resizable) override
            {
                NSWindowStyleMask mask = [window_ styleMask];
                mask = resizable ? (mask | NSWindowStyleMaskResizable) : (mask & ~NSWindowStyleMaskResizable);
                [window_ setStyleMask:mask];
            }

            void setContentSize(int width, int height) override
            {
                ignoreResize_ = true;
                [window_ setContentSize:NSMakeSize(width, height)];
                ignoreResize_ = false;
            }

            void show() override
            {
                [window_ makeKeyAndOrderFront:nil];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
                // Deprecated in macOS 14 for -activate, which 12 and 13 lack.
                [NSApp activateIgnoringOtherApps:YES];
#pragma clang diagnostic pop
            }

            [[nodiscard]] double scale() const override { return 1.0; }

        private:
            EventLoop& loop_;
            Callbacks callbacks_;
            NSWindow* window_ = nil;
            NSView* content_ = nil;
            std::vector<id> observers_;
            bool ignoreResize_ = false;
            bool closing_ = false;
        };
    } // namespace

    std::unique_ptr<EditorWindow> EditorWindow::create(EventLoop& loop, const std::string& title, int width, int height,
                                                       Callbacks callbacks, std::string& error)
    {
        if (NSApp == nil)
        {
            error = "the editor needs UI mode";
            return nullptr;
        }
        return std::make_unique<MacEditorWindow>(loop, title, width, height, std::move(callbacks));
    }
} // namespace soundor::vst3host
