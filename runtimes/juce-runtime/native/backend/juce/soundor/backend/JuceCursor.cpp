// JUCE declares its X11 window system only for those that ask, and X11's
// headers define macros (None, Status) that the rest of the adapters must not
// see: this file is the only one that asks.
#define JUCE_GUI_BASICS_INCLUDE_XHEADERS 1

#include "JuceInput.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
#if (JUCE_LINUX || JUCE_BSD) && JUCE_USE_XCURSOR
    namespace
    {
        // The arrow of the user's cursor theme, at the user's cursor size, as
        // a JUCE cursor: JUCE's NormalCursor is no cursor of the window's own
        // on X11, which shows the parent window's, and a plugin's parent is
        // the host's window, whose cursor can be anything (a resize cursor
        // left there by the host).
        class ThemedArrow final : private juce::DeletedAtShutdown
        {
        public:
            ThemedArrow() : cursor(load()) {}
            ~ThemedArrow() override { clearSingletonInstance(); }

            juce::MouseCursor cursor;

            JUCE_DECLARE_SINGLETON_INLINE(ThemedArrow, false)

        private:
            static juce::MouseCursor load()
            {
                auto* display = juce::XWindowSystem::getInstance()->getDisplay();
                // libXcursor, which JUCE has loaded already for its own cursors.
                juce::DynamicLibrary library("libXcursor.so.1");
                const auto getTheme =
                    reinterpret_cast<const char* (*)(::Display*)>(library.getFunction("XcursorGetTheme"));
                const auto getSize =
                    reinterpret_cast<int (*)(::Display*)>(library.getFunction("XcursorGetDefaultSize"));
                const auto loadImage = reinterpret_cast<XcursorImage* (*)(const char*, const char*, int)>(
                    library.getFunction("XcursorLibraryLoadImage"));
                const auto destroyImage =
                    reinterpret_cast<void (*)(XcursorImage*)>(library.getFunction("XcursorImageDestroy"));
                if (display == nullptr || getTheme == nullptr || getSize == nullptr || loadImage == nullptr
                    || destroyImage == nullptr)
                    return juce::MouseCursor::NormalCursor;

                XcursorImage* image = loadImage("left_ptr", getTheme(display), getSize(display));
                if (image == nullptr)
                    return juce::MouseCursor::NormalCursor;

                const auto width = static_cast<int>(image->width);
                const auto height = static_cast<int>(image->height);
                juce::Image arrow(juce::Image::ARGB, width, height, true);
                // Xcursor's pixels are premultiplied, and JUCE hands Xcursor
                // the image's colours unpremultiplied: set each as a colour
                // so that what JUCE reads back is the theme's pixel.
                for (int y = 0; y < height; ++y)
                    for (int x = 0; x < width; ++x)
                        arrow.setPixelAt(x, y, juce::Colour(image->pixels[(y * width) + x]));
                const juce::Point<int> hotspot { static_cast<int>(image->xhot), static_cast<int>(image->yhot) };
                destroyImage(image);
                return { juce::ScaledImage(arrow), hotspot };
            }
        };
    } // namespace

    juce::MouseCursor arrowCursor()
    {
        // The window system first, so that it outlives the arrow at shutdown
        // (DeletedAtShutdown deletes the newest first).
        juce::XWindowSystem::getInstance();
        return ThemedArrow::getInstance()->cursor;
    }
#else
    juce::MouseCursor arrowCursor()
    {
        return juce::MouseCursor::NormalCursor;
    }
#endif
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
