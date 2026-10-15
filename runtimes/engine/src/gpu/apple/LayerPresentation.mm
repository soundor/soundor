#include "gpu/Presentation.h"

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        // A plain CALayer added on top of the view's own layer: ANGLE puts its
        // CAMetalLayer inside it. The view keeps getting input and drawing
        // underneath.
        class LayerPresentation final : public Presentation
        {
        public:
            explicit LayerPresentation(NSView* view) : host(view)
            {
                view.wantsLayer = YES;
                layer = [CALayer layer];
                layer.opaque = YES;
                layer.anchorPoint = CGPointZero;
                [view.layer addSublayer:layer];
            }

            ~LayerPresentation() override { [layer removeFromSuperlayer]; }

            void* nativeWindow() const noexcept override { return (__bridge void*)layer; }

            void setBounds(float x, float y, float width, float height, float scale) override
            {
                [CATransaction begin];
                [CATransaction setDisableActions:YES];
                CALayer* parent = layer.superlayer;
                // Layer geometry is the view's unless the view is flipped and its layer is not.
                const bool flip = parent != nil && host.isFlipped && ! parent.geometryFlipped;
                const CGFloat top = flip ? parent.bounds.size.height - y - height : y;
                layer.frame = CGRectMake(x, top, width, height);
                layer.contentsScale = scale;
                [CATransaction commit];
            }

            void setVisible(bool visible) override { layer.hidden = ! visible; }

        private:
            __weak NSView* host;
            CALayer* layer;
        };
    } // namespace

    std::unique_ptr<Presentation> createPresentation(void* view, std::string* failure)
    {
        auto* nsView = (__bridge NSView*)view;
        if (nsView == nil)
        {
            if (failure != nullptr)
                *failure = "no view to present in";
            return nullptr;
        }
        return std::make_unique<LayerPresentation>(nsView);
    }

    bool presentationAvailable() noexcept
    {
        return true;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
