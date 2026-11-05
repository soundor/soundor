// The native window an editor (IPlugView) is attached to: an X11 window on
// Linux, an NSWindow on macOS and an HWND on Windows. Sizes are in the
// view's coordinates: physical pixels on Linux and Windows, points on macOS
// (IPlugView's convention).
#pragma once

#include "EventLoop.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace soundor::vst3host
{
    class EditorWindow
    {
    public:
        struct Callbacks
        {
            /** The user resized the window; the editor gets the new size. */
            std::function<void(int width, int height)> resized;
            /** The user closed the window. */
            std::function<void()> closed;
            std::function<void(bool focused)> focusChanged;
            /** Windows and Linux: the monitor's scale changed. */
            std::function<void(double scale)> scaleChanged;
        };

        virtual ~EditorWindow() = default;

        /** A window that is the editor alone (the `editor` presentation) on
            macOS and Windows; nullptr and `error` when none can be made. The
            host interface's window, and Linux's in either presentation, is a
            HostWindow. */
        static std::unique_ptr<EditorWindow> create(EventLoop& loop, const std::string& title, int width, int height,
                                                    Callbacks callbacks, std::string& error);

        /** The IPlugView platform type and the parent handle to attach to. */
        [[nodiscard]] virtual const char* platformType() const = 0;
        [[nodiscard]] virtual void* parentHandle() const = 0;

        virtual void setResizable(bool resizable) = 0;
        /** Resizes the editor's area to the editor's size, without calling
            `resized`. */
        virtual void setContentSize(int width, int height) = 0;
        /** The smallest size the editor keeps to: the window need not be
            smaller than what that takes. */
        virtual void setEditorMinimum(int width, int height) { (void)width, (void)height; }
        /** The largest editor there is: a window that is the editor need not
            be larger. */
        virtual void setEditorMaximum(int width, int height) { (void)width, (void)height; }
        /** The largest editor the window has room for, where it is not to
            grow for one (the host presentation, as in the web host): at least
            the editor's size. */
        [[nodiscard]] virtual std::optional<std::pair<int, int>> editorRoom() const { return std::nullopt; }
        /** The editor's limits corrected a size from `resized`. */
        virtual void constrainContentSize(int width, int height) { setContentSize(width, height); }
        virtual void show() = 0;
        /** The platform's scale for this window (1 on macOS, whose views are
            in points). */
        [[nodiscard]] virtual double scale() const = 0;
        /** "editor" (the window is the editor) or "host" (with the host interface). */
        [[nodiscard]] virtual const char* presentation() const { return "editor"; }
        /** The window's content size, in the editor's coordinates. */
        [[nodiscard]] virtual std::pair<int, int> windowSize() const = 0;
        /** The host interface's frames presented so far; none without it. */
        [[nodiscard]] virtual std::optional<uint64_t> interfaceFrames() const { return std::nullopt; }
    };
} // namespace soundor::vst3host
