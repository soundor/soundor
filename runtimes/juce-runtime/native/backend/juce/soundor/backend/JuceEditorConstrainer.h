#pragma once

// JUCE backend: the size constraints of an editor that scales (editor
// resize: 'scale').

#include <juce_gui_basics/juce_gui_basics.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Holds an editor within its limits, and keeps its aspect ratio only
    // where nothing would fight it. A VST3 host that asks first
    // (checkSizeConstraint, which reads the ratio) is offered sizes of the
    // editor's shape; one that sets a size of another shape regardless
    // (Ardour) gets that size, and the editor draws its UI letterboxed in
    // it. Enforcing the ratio there would make the editor ask the host for
    // its own shape (resizeView) on every step of a drag, which the host
    // undoes on the next: the window flickers between the two. The
    // Standalone's window has no host to fight, so it keeps the ratio.
    class JuceEditorConstrainer final : public juce::ComponentBoundsConstrainer
    {
    public:
        explicit JuceEditorConstrainer(bool enforceRatio) : enforceRatio(enforceRatio) {}

        void checkBounds(juce::Rectangle<int>& bounds, const juce::Rectangle<int>& previous,
                         const juce::Rectangle<int>& limits, bool top, bool left, bool bottom, bool right) override
        {
            if (enforceRatio)
            {
                ComponentBoundsConstrainer::checkBounds(bounds, previous, limits, top, left, bottom, right);
                return;
            }
            const double ratio = getFixedAspectRatio();
            setFixedAspectRatio(0.0);
            ComponentBoundsConstrainer::checkBounds(bounds, previous, limits, top, left, bottom, right);
            setFixedAspectRatio(ratio);
        }

    private:
        bool enforceRatio;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
