#pragma once

// JUCE backend: the size constraints of a resizable editor.

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdlib>
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

        // A size the host gave in place of the one a request asked of it
        // (Ardour: its window has a minimum of its own, so it sets the editor
        // back to the window's size). Later requests keep to what it showed:
        // no smaller than it gave where it gave more, no larger where less,
        // so a grip dragged on past it stops there rather than resizing the
        // editor inside a window that stays, which springs back each time.
        // A pixel or two off is the host rounding (a display's scale), not a
        // limit; the Standalone has no host.
        void hostReplaced(juce::Point<int> asked, juce::Point<int> given) noexcept
        {
            if (enforce)
                return;
            constexpr int rounding = 2;
            if (std::abs(given.x - asked.x) <= rounding)
                given.x = asked.x;
            if (std::abs(given.y - asked.y) <= rounding)
                given.y = asked.y;
            if (given.x > asked.x)
                hostLeast.x = std::max(hostLeast.x, given.x);
            if (given.y > asked.y)
                hostLeast.y = std::max(hostLeast.y, given.y);
            if (given.x < asked.x)
                hostMost.x = std::min(hostMost.x, given.x);
            if (given.y < asked.y)
                hostMost.y = std::min(hostMost.y, given.y);
        }

        // A size the host set of its own (its window resized): what it showed
        // of its limits gives way to it.
        void hostGave(juce::Point<int> given) noexcept
        {
            hostLeast = { std::min(hostLeast.x, given.x), std::min(hostLeast.y, given.y) };
            hostMost = { std::max(hostMost.x, given.x), std::max(hostMost.y, given.y) };
        }

        // A new press: what the host showed held the drag that showed it. Its
        // window may have room now (it was maximized, say), and nothing else
        // would say so: a host with a limit shows it again, once.
        void forgetHostLimits() noexcept
        {
            hostLeast = {};
            hostMost = { INT_MAX, INT_MAX };
        }

        // The size plugin code asks for (soundor:ui's requestEditorSize(),
        // whole and positive) held to the limits, and to what the host showed
        // of its own (hostReplaced()): each side within them, or
        // with an editor that scales keeping its ratio, the layout's size
        // times the zoom nearest to the size asked for (the point at its
        // ratio closest to a corner dragged anywhere), within the zooms the
        // limits allow, then rounded. Never from the editor's current size,
        // which would make the same drag answer differently as it resizes.
        // The Web host's constrainSize() does the same.
        [[nodiscard]] juce::Point<int> constrainRequest(juce::Point<int> wanted) const noexcept
        {
            const juce::Point<int> least { std::max(getMinimumWidth(), hostLeast.x),
                                           std::max(getMinimumHeight(), hostLeast.y) };
            const juce::Point<int> most { std::min(getMaximumWidth(), hostMost.x),
                                          std::min(getMaximumHeight(), hostMost.y) };
            if (! scaledLayout || scaledLayout->x <= 0 || scaledLayout->y <= 0)
                return { held(wanted.x, least.x, most.x), held(wanted.y, least.y, most.y) };
            const double width = scaledLayout->x;
            const double height = scaledLayout->y;
            const double asked = (wanted.x * width + wanted.y * height) / (width * width + height * height);
            const double smallest = std::max(least.x / width, least.y / height);
            const double largest = std::min(most.x / width, most.y / height);
            const double zoom = std::min(std::max(asked, smallest), std::max(smallest, largest));
            return { static_cast<int>(std::lround(width * zoom)), static_cast<int>(std::lround(height * zoom)) };
        }

    private:
        static int held(int value, int least, int most) noexcept
        {
            return std::min(std::max(value, least), std::max(least, most));
        }

        bool enforce;
        std::optional<juce::Point<int>> scaledLayout;
        juce::Point<int> hostLeast { 0, 0 };
        juce::Point<int> hostMost { INT_MAX, INT_MAX };
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
