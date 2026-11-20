// macOS: the editor's view, a layer-backed NSView in the host's, and the CPU
// frames shown in it (a sublayer's contents). A plain NSView: no Objective-C
// class is added (the engine's input and GPU presentation, which add their
// own views and layers, read whether a view is flipped; this one is not).

#include "NativeWindow.h"

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#include <algorithm>
#include <vector>

namespace soundor::vst3
{
    namespace
    {
        CGColorRef colour(std::uint32_t argb)
        {
            const auto channel = [argb](int shift)
            { return static_cast<CGFloat>((argb >> shift) & 0xFFU) / static_cast<CGFloat>(255); };
            return CGColorCreateSRGB(channel(16), channel(8), channel(0), channel(24));
        }

        NSCursor* hiddenCursor()
        {
            static NSCursor* hidden = [[NSCursor alloc] initWithImage:[[NSImage alloc] initWithSize:NSMakeSize(1, 1)]
                                                              hotSpot:NSZeroPoint];
            return hidden;
        }

        NSCursor* diagonalCursor(bool northEast)
        {
            if (@available(macOS 15.0, *))
                return [NSCursor frameResizeCursorFromPosition:northEast ? NSCursorFrameResizePositionTopRight
                                                                         : NSCursorFrameResizePositionTopLeft
                                                  inDirections:NSCursorFrameResizeDirectionsAll];
            return [NSCursor crosshairCursor];
        }

        NSCursor* cursorOf(ui::Cursor cursor)
        {
            switch (cursor)
            {
                case ui::Cursor::Pointer:
                    return [NSCursor pointingHandCursor];
                case ui::Cursor::Text:
                    return [NSCursor IBeamCursor];
                case ui::Cursor::Crosshair:
                    return [NSCursor crosshairCursor];
                case ui::Cursor::Move:
                    return [NSCursor openHandCursor];
                case ui::Cursor::EwResize:
                    return [NSCursor resizeLeftRightCursor];
                case ui::Cursor::NsResize:
                    return [NSCursor resizeUpDownCursor];
                case ui::Cursor::NeswResize:
                    return diagonalCursor(true);
                case ui::Cursor::NwseResize:
                    return diagonalCursor(false);
                case ui::Cursor::None:
                    return hiddenCursor();
                default:
                    return [NSCursor arrowCursor];
            }
        }

        class MacWindow;

        // A CPU compositor's frames: a bitmap context over its pixels, whose
        // image is the frame layer's contents.
        class LayerTarget final : public render::RasterTarget
        {
        public:
            explicit LayerTarget(MacWindow& owner) : window(owner) {}
            ~LayerTarget() override { release(); }
            LayerTarget(const LayerTarget&) = delete;
            LayerTarget& operator=(const LayerTarget&) = delete;
            LayerTarget(LayerTarget&&) = delete;
            LayerTarget& operator=(LayerTarget&&) = delete;

            Pixels acquire(int width, int height) override
            {
                width = std::max(1, width);
                height = std::max(1, height);
                bool preserved = true;
                if (width != imageWidth || height != imageHeight || context == nullptr)
                {
                    preserved = false;
                    release();
                    pixels.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0);
                    imageWidth = width;
                    imageHeight = height;
                    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
                    // B, G, R, A in memory, premultiplied: the engine's Bitmap.
                    context = CGBitmapContextCreate(pixels.data(), static_cast<std::size_t>(width),
                                                    static_cast<std::size_t>(height), 8,
                                                    static_cast<std::size_t>(width) * 4, space,
                                                    static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedFirst)
                                                        | static_cast<CGBitmapInfo>(kCGBitmapByteOrder32Little));
                    CGColorSpaceRelease(space);
                }
                return { { pixels.data(), width, height, static_cast<std::size_t>(width) * 4 }, preserved };
            }

            void present(const render::Region&) override;

            [[nodiscard]] int width() const noexcept { return imageWidth; }
            [[nodiscard]] int height() const noexcept { return imageHeight; }
            [[nodiscard]] CGImageRef image() const
            {
                return context != nullptr ? CGBitmapContextCreateImage(context) : nullptr;
            }

        private:
            void release()
            {
                if (context != nullptr)
                    CGContextRelease(context);
                context = nullptr;
            }

            MacWindow& window;
            std::vector<std::uint32_t> pixels;
            CGContextRef context = nullptr;
            int imageWidth = 0;
            int imageHeight = 0;
        };

        class MacWindow final : public NativeWindow
        {
        public:
            MacWindow(NSView* parent, int width, int height, std::uint32_t background) : image(*this)
            {
                nsView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
                nsView.wantsLayer = YES;
                nsView.autoresizingMask = NSViewNotSizable;
                frameLayer = [CALayer layer];
                frameLayer.anchorPoint = CGPointZero;
                frameLayer.actions =
                    @ { @"contents" : [NSNull null], @"bounds" : [NSNull null], @"position" : [NSNull null] };
                frameLayer.magnificationFilter = kCAFilterNearest;
                setBackground(background);
                [nsView.layer addSublayer:frameLayer];
                [parent addSubview:nsView];
            }

            ~MacWindow() override
            {
                [frameLayer removeFromSuperlayer];
                [nsView removeFromSuperview];
            }
            MacWindow(const MacWindow&) = delete;
            MacWindow& operator=(const MacWindow&) = delete;
            MacWindow(MacWindow&&) = delete;
            MacWindow& operator=(MacWindow&&) = delete;

            [[nodiscard]] void* view() const noexcept override { return (__bridge void*)nsView; }

            void resize(int width, int height) override
            {
                [nsView setFrameSize:NSMakeSize(width, height)];
                layout();
            }

            void setCursor(ui::Cursor shape) override
            {
                cursor = cursorOf(shape);
                tick();
            }

            [[nodiscard]] std::optional<ui::Point> screenOrigin() const override { return std::nullopt; }

            [[nodiscard]] float backingScale() const override
            {
                NSWindow* window = nsView.window;
                return window != nil ? static_cast<float>(window.backingScaleFactor) : 1.0f;
            }

            void tick() override
            {
                // AppKit shows the cursor the last view under the pointer set:
                // this one's, while the pointer is over it.
                NSWindow* window = nsView.window;
                if (cursor == nil || window == nil || ! window.visible)
                    return;
                const NSPoint inWindow = [window mouseLocationOutsideOfEventStream];
                const NSPoint point = [nsView convertPoint:inWindow fromView:nil];
                if (! NSPointInRect(point, nsView.bounds) || nsView.hiddenOrHasHiddenAncestor)
                    return;
                if ([NSCursor currentCursor] != cursor)
                    [cursor set];
            }

            render::RasterTarget& raster() override { return image; }

            void placeFrame(float x, float y, std::uint32_t background) override
            {
                left = x;
                top = y;
                setBackground(background);
                layout();
            }

            void repaint() override { show(); }

            // The frame layer's contents: the last frame.
            void show()
            {
                CGImageRef frame = image.image();
                [CATransaction begin];
                [CATransaction setDisableActions:YES];
                frameLayer.contents = (__bridge id)frame;
                [CATransaction commit];
                if (frame != nullptr)
                    CGImageRelease(frame);
                layout();
            }

        private:
            void setBackground(std::uint32_t background)
            {
                CGColorRef fill = colour(background);
                nsView.layer.backgroundColor = fill;
                CGColorRelease(fill);
            }

            // The frame layer at (left, top) from the view's top-left, in
            // points: the frame is in device pixels.
            void layout()
            {
                const CGFloat scale = backingScale();
                const CGFloat width = static_cast<CGFloat>(image.width()) / scale;
                const CGFloat height = static_cast<CGFloat>(image.height()) / scale;
                const CGFloat bottom =
                    nsView.layer.geometryFlipped ? top : nsView.bounds.size.height - static_cast<CGFloat>(top) - height;
                [CATransaction begin];
                [CATransaction setDisableActions:YES];
                frameLayer.contentsScale = scale;
                frameLayer.frame = CGRectMake(left, bottom, width, height);
                [CATransaction commit];
            }

            NSView* nsView = nil;
            CALayer* frameLayer = nil;
            NSCursor* cursor = nil;
            LayerTarget image;
            float left = 0;
            float top = 0;
        };

        void LayerTarget::present(const render::Region&)
        {
            window.show();
        }
    } // namespace

    std::unique_ptr<NativeWindow> NativeWindow::create(void* parent, int width, int height, std::uint32_t background,
                                                       std::string& error)
    {
        NSView* host = (__bridge NSView*)parent;
        if (host == nil || ! [host isKindOfClass:[NSView class]])
        {
            error = "the host's view is not an NSView";
            return nullptr;
        }
        return std::make_unique<MacWindow>(host, width, height, background);
    }
} // namespace soundor::vst3
