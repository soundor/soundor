// The native window an editor (IPlugView) is attached to: an X11 window on
// Linux, an NSWindow on macOS and an HWND on Windows. Sizes are in the
// view's coordinates: physical pixels on Linux and Windows, points on macOS
// (IPlugView's convention).
#pragma once

#include "EventLoop.h"

#include <functional>
#include <memory>
#include <string>

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
            /** Windows: the monitor's DPI scale changed. */
            std::function<void(double scale)> scaleChanged;
        };

        virtual ~EditorWindow() = default;

        /** nullptr and `error` when no window can be made (no display). */
        static std::unique_ptr<EditorWindow> create(EventLoop& loop, const std::string& title, int width, int height,
                                                    Callbacks callbacks, std::string& error);

        /** The IPlugView platform type and the parent handle to attach to. */
        [[nodiscard]] virtual const char* platformType() const = 0;
        [[nodiscard]] virtual void* parentHandle() const = 0;

        virtual void setResizable(bool resizable) = 0;
        /** Resizes the content area without calling `resized`. */
        virtual void setContentSize(int width, int height) = 0;
        virtual void show() = 0;
        /** The platform's scale for this window (1 on macOS and Linux). */
        [[nodiscard]] virtual double scale() const = 0;
    };
} // namespace soundor::vst3host
