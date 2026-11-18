#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/ui/Input.h>

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    // A platform's own input for one plugin view, read by Soundor rather than
    // through the plugin framework (JUCE). The framework still owns the
    // native view; this reads what the user does in it and hands it over in
    // ui/Input.h's normalized form, for the backend to give its Surface as
    // it gives the framework's input.
    //
    // Linux (X11, XWayland included): pointer, wheel, keyboard, text and
    // focus, read with XInput 2 on a connection of the input's own (see
    // contribute/engine-reference.md, "Native input").
    // macOS uses a child NSView; Windows subclasses the framework's HWND.

    // The native view the input is read in. Linux: the X11 window (its XID)
    // the framework shows the editor in. macOS: the framework's NSView.
    // Windows: the framework's Unicode HWND (no new window is created).
    struct NativeView
    {
        void* handle = nullptr;
    };

    // Where the editor is in the native view: its top-left corner in the
    // view's physical pixels (macOS: AppKit points), native units per
    // logical pixel of the editor, and its size in its logical pixels (0: to the view's edges).
    // Pointer input is read over that area alone (a framework's own
    // controls around it keep theirs), and positions are given in the
    // editor's logical pixels from its top-left, as a framework gives them.
    struct ViewGeometry
    {
        float x = 0;
        float y = 0;
        float scale = 1;
        float width = 0;
        float height = 0;

        friend bool operator==(const ViewGeometry&, const ViewGeometry&) = default;
    };

    // A key as Surface::key(input, typed) takes it: the key, and the text
    // its press types (empty for a release, a named key, a shortcut).
    struct KeyEvent
    {
        ui::KeyInput key;
        std::string typed;
    };

    // The native view's window gained or lost the keyboard focus. Keys held
    // when it is lost are released before (key-ups).
    struct FocusChange
    {
        bool focused = false;
    };

    // In the order they happened. TextInput is text an input method
    // committed without a key (composition).
    using Event = std::variant<ui::PointerInput, ui::WheelInput, KeyEvent, ui::TextInput, FocusChange>;

    struct PlatformOptions
    {
        NativeView view;
        // Presses closer together than this, of the same button, in about
        // the same place and not a drag, count as a series (clicks).
        std::chrono::milliseconds doubleClickTime { 400 };
    };

    // Everything is called on the thread the framework's UI runs on, which
    // is the one events are read on: no thread of its own.
    class PlatformInput
    {
    public:
        virtual ~PlatformInput() = default;

        // What the framework's event loop watches: read() when it is
        // readable (and also every tick: a request may have read events in).
        // -1 where there is none.
        [[nodiscard]] virtual int fileDescriptor() const = 0;
        // Appends what arrived since the last call to `events`.
        virtual void read(std::vector<Event>& events) = 0;
        // Ends what is in progress, as if the view went away: a pressed
        // pointer is cancelled, held keys go up. Call before destroying it
        // while its Surface is still there.
        virtual void cancel(std::vector<Event>& events) = 0;

        virtual void setGeometry(const ViewGeometry& geometry) = 0;
        // While the framework shows something of its own over the view (a
        // menu, a modal dialog: JUCE's in a Standalone), the view's input is
        // the framework's, as that expects (a press outside a menu closes
        // it): a press in progress is cancelled and held keys go up (into
        // `events`), and nothing is read until it is gone.
        virtual void setSuspended(bool suspended, std::vector<Event>& events) = 0;
        // Whether the node with Soundor's focus takes text (a text input):
        // an input method composes only then, so elsewhere keys stay keys.
        virtual void setTextInputFocused(bool focused) = 0;

        // Request the native first responder after the framework focuses the
        // editor. Platforms whose framework owns the responder need no work.
        virtual void requestFocus() {}

        // Whether the view has the keyboard focus.
        [[nodiscard]] virtual bool focused() const = 0;
        // The buttons held, as PointerInput::buttons.
        [[nodiscard]] virtual unsigned buttons() const = 0;
        // Where the pointer is on the screen, in native units (macOS: desktop
        // points, Linux: physical pixels), and
        // moves it there (a pointer lock keeping it in the view). Under
        // Wayland (XWayland), moving it is up to the compositor.
        [[nodiscard]] virtual std::optional<ui::Point> pointerOnScreen() const = 0;
        virtual void warpPointer(ui::Point onScreen) = 0;
    };

    // The platform's input for `options.view`, or null where Soundor reads
    // none, or cannot (`failure` says why: no X server, no
    // XInput 2, the view gone): the framework's input stays.
    [[nodiscard]] std::unique_ptr<PlatformInput> createPlatformInput(const PlatformOptions& options,
                                                                     std::string* failure = nullptr);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
