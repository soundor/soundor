#pragma once

// JUCE backend: the size constraints of a resizable editor.

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>
#include <cmath>
#include <optional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Holds an editor to the size soundor.config asks for where nothing would
    // fight it, and offers it everywhere else. Its limits (and the aspect
    // ratio of an editor that scales) are what a VST3 host that asks first
    // (checkSizeConstraint, which reads them) is offered. The Standalone's
    // window has no host to fight, so it keeps them all. In a plugin, a size
    // the host sets regardless (onSize, applied through checkBounds) keeps
    // only to the minimum: a host that sets a wider window than the maximum
    // (Ardour) gives the editor that window, whose UI then fills it as its
    // `fit` says, rather than leaving the host's background beside it; and
    // one that sets another shape gets it, the UI letterboxed or covering
    // it. Enforcing the ratio there would make the editor ask the host for
    // its own shape (resizeView) on every step of a drag, which the host
    // undoes on the next: the window flickers between the two.
    class JuceEditorConstrainer final : public juce::ComponentBoundsConstrainer
    {
    public:
        explicit JuceEditorConstrainer(bool enforceAll) : enforce(enforceAll) {}

        void checkBounds(juce::Rectangle<int>& bounds, const juce::Rectangle<int>& previous,
                         const juce::Rectangle<int>& limits, bool top, bool left, bool bottom, bool right) override
        {
            if (enforce)
            {
                ComponentBoundsConstrainer::checkBounds(bounds, previous, limits, top, left, bottom, right);
                return;
            }
            bounds.setSize(std::max(bounds.getWidth(), getMinimumWidth()),
                           std::max(bounds.getHeight(), getMinimumHeight()));
        }

        // The size an editor that scales keeping its aspect ratio is designed
        // at: requests keep that shape.
        void setScaledLayout(juce::Point<int> layout) noexcept { scaledLayout = layout; }

        // The size plugin code asks for (soundor:ui's requestEditorSize(),
        // whole and positive) held to the limits, from the editor's `current`
        // size: each side within them, or with an editor that scales keeping
        // its ratio, the layout's size times one zoom, the zoom of the side
        // asked to change the more from the current zoom (a corner dragged
        // mostly sideways, an arrow key), within the zooms the limits allow,
        // then rounded. The Web host's constrainSize() does the same.
        [[nodiscard]] juce::Point<int> constrainRequest(juce::Point<int> wanted,
                                                        juce::Point<int> current) const noexcept
        {
            if (! scaledLayout || scaledLayout->x <= 0 || scaledLayout->y <= 0)
                return { held(wanted.x, getMinimumWidth(), getMaximumWidth()),
                         held(wanted.y, getMinimumHeight(), getMaximumHeight()) };
            const double width = scaledLayout->x;
            const double height = scaledLayout->y;
            const double now = std::min(current.x / width, current.y / height);
            const double across = wanted.x / width;
            const double down = wanted.y / height;
            const double asked = std::abs(across - now) >= std::abs(down - now) ? across : down;
            const double least = std::max(getMinimumWidth() / width, getMinimumHeight() / height);
            const double most = std::min(getMaximumWidth() / width, getMaximumHeight() / height);
            const double zoom = std::min(std::max(asked, least), std::max(least, most));
            return { static_cast<int>(std::lround(width * zoom)), static_cast<int>(std::lround(height * zoom)) };
        }

    private:
        static int held(int value, int least, int most) noexcept
        {
            return std::min(std::max(value, least), std::max(least, most));
        }

        bool enforce;
        std::optional<juce::Point<int>> scaledLayout;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
