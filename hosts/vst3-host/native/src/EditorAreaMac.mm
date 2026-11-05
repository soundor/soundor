#include "EditorArea.h"

#import <Cocoa/Cocoa.h>
#include <SDL3/SDL.h>

namespace soundor::vst3host
{
    namespace
    {
        class MacEditorArea final : public EditorArea
        {
        public:
            explicit MacEditorArea(NSView* content) : content_([content retain])
            {
                view_ = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 1, 1)];
                [content_ addSubview:view_ positioned:NSWindowAbove relativeTo:nil];
            }

            ~MacEditorArea() override
            {
                [view_ removeFromSuperview];
                [view_ release];
                [content_ release];
            }

            [[nodiscard]] const char* platformType() const override { return "NSView"; }
            [[nodiscard]] void* handle() const override { return static_cast<void*>(view_); }

            void setFrame(int x, int y, int width, int height) override
            {
                const CGFloat top = [content_ isFlipped] ? y : [content_ bounds].size.height - y - height;
                [view_ setFrame:NSMakeRect(x, top, width, height)];
            }

        private:
            NSView* content_;
            NSView* view_ = nil;
        };
    } // namespace

    std::unique_ptr<EditorArea> EditorArea::create(SDL_Window* window, std::string& error)
    {
        auto* nsWindow = static_cast<NSWindow*>(
            SDL_GetPointerProperty(SDL_GetWindowProperties(window), SDL_PROP_WINDOW_COCOA_WINDOW_POINTER, nullptr));
        if (nsWindow == nil || [nsWindow contentView] == nil)
        {
            error = "the host interface's window is not a Cocoa window";
            return nullptr;
        }
        return std::make_unique<MacEditorArea>([nsWindow contentView]);
    }
} // namespace soundor::vst3host
