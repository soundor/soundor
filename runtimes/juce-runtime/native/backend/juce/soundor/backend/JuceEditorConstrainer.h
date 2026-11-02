#pragma once

// JUCE backend: the size constraints of a resizable editor.

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>

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

    private:
        bool enforce;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
