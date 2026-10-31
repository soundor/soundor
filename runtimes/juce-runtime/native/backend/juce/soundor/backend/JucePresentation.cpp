#include "JucePresentation.h"

#include <cmath>
#include <cstddef>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    render::RasterTarget::Pixels JuceImageTarget::acquire(int width, int height)
    {
        pixels.reset();
        const bool preserved = matches(width, height);
        if (! preserved)
            // JUCE's ARGB pixels are Skia's native 32-bit premultiplied format.
            image = juce::Image(juce::Image::ARGB, width, height, true, juce::SoftwareImageType());
        pixels.emplace(image, juce::Image::BitmapData::readWrite);
        return { { pixels->data, width, height, static_cast<std::size_t>(pixels->lineStride) }, preserved };
    }

    void JuceImageTarget::present(const render::Region& damage)
    {
        pixels.reset();
        const auto shown = shownArea();
        if (! image.isValid() || shown.isEmpty())
            return;
        // Device pixels to the component's coordinates, out to whole units.
        const double scaleX = static_cast<double>(shown.getWidth()) / image.getWidth();
        const double scaleY = static_cast<double>(shown.getHeight()) / image.getHeight();
        for (const render::IntRect& rect : damage.rects())
        {
            const auto left = static_cast<int>(std::floor(shown.getX() + rect.x * scaleX));
            const auto top = static_cast<int>(std::floor(shown.getY() + rect.y * scaleY));
            component.repaint(left, top, static_cast<int>(std::ceil(shown.getX() + rect.right() * scaleX)) - left,
                              static_cast<int>(std::ceil(shown.getY() + rect.bottom() * scaleY)) - top);
        }
    }

    void JuceImageTarget::paint(juce::Graphics& g) const
    {
        if (image.isValid())
            g.drawImage(image, shownArea());
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
