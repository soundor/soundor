#pragma once

// JUCE backend: where a compositor's result is shown in a JUCE component.

#include <soundor/render/Compositor.h>

#include <juce_gui_basics/juce_gui_basics.h>

#include <optional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Shows a CPU compositor's result (render::RasterCompositor) in a
    // component: an image at device resolution that paint() draws over the
    // component, repainting only the parts that changed.
    class JuceImageTarget final : public render::RasterTarget
    {
    public:
        explicit JuceImageTarget(juce::Component& view) : component(view) {}

        Pixels acquire(int width, int height) override;
        void present(const render::Region& damage) override;

        // Whether the image is `width`×`height` device pixels.
        [[nodiscard]] bool matches(int width, int height) const noexcept
        {
            return image.isValid() && image.getWidth() == width && image.getHeight() == height;
        }
        // Draws the image as last presented, over the whole component.
        void paint(juce::Graphics& g) const;

    private:
        juce::Component& component;
        juce::Image image;
        std::optional<juce::Image::BitmapData> pixels;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
