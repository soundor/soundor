#pragma once

// JUCE backend: the pointer lock a Soundor view asks for (Surface::pointerLock).

#include <soundor/Abi.h>

#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>
#include <memory>
#include <optional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Keeps a locked pointer in the view, hidden there (the editor shows no
    // cursor while active()): when it strays from where the lock began, it is
    // moved back, and the view's positions carry on past the edges as if
    // nothing stopped it. A cursor is a window's, not the screen's, on Linux,
    // so a pointer that left the view would show.
    //
    // However the lock ends (a release, the view letting go, a drag the
    // platform ended without one, a reload, the editor closing: the
    // destructor), the pointer shows again where it began.
    class PointerLock
    {
    public:
        // A mouse source as the lock uses it: juce::MouseInputSource's calls.
        class Source
        {
        public:
            virtual ~Source() = default;
            [[nodiscard]] virtual bool isDragging() const = 0;
            [[nodiscard]] virtual juce::Point<float> screenPosition() const = 0;
            virtual void setScreenPosition(juce::Point<float> position) = 0;
        };
        // The source of a Soundor pointer id, or null.
        using Sources = std::function<std::unique_ptr<Source>(int pointerId)>;

        // juce::Desktop's mouse sources: pointer id n is source n - 1.
        PointerLock();
        explicit PointerLock(Sources sources);
        ~PointerLock();

        PointerLock(const PointerLock&) = delete;
        PointerLock& operator=(const PointerLock&) = delete;

        // The pointer the view locks now, if any, and where in the view the
        // lock began: locks its source while it is dragging, else ends the
        // lock. Call after input and every tick.
        void update(std::optional<int> pointerId, juce::Point<float> where);
        // The view position of a locked pointer's move to `position` (in the
        // view, whose size is `size`), continued past the view's edges; moves
        // the pointer back when it strays. Other pointers' are as they are.
        [[nodiscard]] juce::Point<float> follow(int pointerId, juce::Point<float> position, juce::Point<float> size);
        // Ends the lock: the pointer shows again where it began.
        void release();
        [[nodiscard]] bool active() const noexcept { return locked.has_value(); }

    private:
        Sources sources;
        std::optional<int> locked;
        juce::Point<float> startOnScreen;
        juce::Point<float> start;  // in the view
        juce::Point<float> offset; // the moves back, added up
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
