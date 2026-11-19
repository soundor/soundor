#pragma once

// The pointer lock a Soundor view asks for (ui::Surface::pointerLock()),
// applied to a pointer: every runtime's editor uses it, with the native
// input's pointer (pointerSource()) or its framework's.

#include <soundor/Abi.h>
#include <soundor/input/Platform.h>
#include <soundor/ui/Input.h>

#include <functional>
#include <memory>
#include <optional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    // Keeps a locked pointer in the view, hidden there (the editor shows no
    // cursor while active()): when it strays from where the lock began, it
    // is moved back, and the view's positions carry on past the edges as if
    // nothing stopped it. A cursor is a window's, not the screen's, on
    // Linux, so a pointer that left the view would show. Under Wayland
    // (XWayland), moving the pointer is the compositor's to allow.
    //
    // However the lock ends (a release, the view letting go, a drag the
    // platform ended without one, a reload, the editor closing: the
    // destructor), the pointer shows again where it began.
    class PointerLock
    {
    public:
        // A pointer as the lock uses it, in its own screen units, which the
        // lock only hands back to it.
        class Source
        {
        public:
            virtual ~Source() = default;
            [[nodiscard]] virtual bool isDragging() const = 0;
            [[nodiscard]] virtual ui::Point screenPosition() const = 0;
            virtual void setScreenPosition(ui::Point position) = 0;
        };
        // The source of a Soundor pointer id, or null.
        using Sources = std::function<std::unique_ptr<Source>(int pointerId)>;

        explicit PointerLock(Sources provided);
        ~PointerLock();

        PointerLock(const PointerLock&) = delete;
        PointerLock& operator=(const PointerLock&) = delete;
        PointerLock(PointerLock&&) = delete;
        PointerLock& operator=(PointerLock&&) = delete;

        // The pointer the view locks now, if any, and where in the view the
        // lock began: locks its source while it is dragging, else ends the
        // lock. Call after input and every tick.
        void update(std::optional<int> pointerId, ui::Point where);
        // The view position of a locked pointer's move to `position` (in the
        // view, whose size is `size`), continued past the view's edges;
        // moves the pointer back when it strays. Other pointers' are as
        // they are.
        [[nodiscard]] ui::Point follow(int pointerId, ui::Point position, ui::Point size);
        // Ends the lock: the pointer shows again where it began.
        void release();
        [[nodiscard]] bool active() const noexcept { return locked.has_value(); }

    private:
        Sources sources;
        std::optional<int> locked;
        ui::Point startOnScreen;
        ui::Point start;  // in the view
        ui::Point offset; // the moves back, added up
    };

    // The mouse (pointer 1) of a platform's native input, or null: its
    // buttons, and its pointerOnScreen() and warpPointer().
    [[nodiscard]] std::unique_ptr<PointerLock::Source> pointerSource(PlatformInput& input, int pointerId);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
