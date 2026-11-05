// The native view an editor attaches to inside the host interface's window:
// an X11 child window, an NSView or a child HWND, placed over the window's
// editor rectangle. The interface draws around it and never under it.
#pragma once

#include <memory>
#include <optional>
#include <string>

struct SDL_Window;

namespace soundor::vst3host
{
    class EditorArea
    {
    public:
        virtual ~EditorArea() = default;

        /** nullptr and `error` when the window has no native view to embed in. */
        static std::unique_ptr<EditorArea> create(SDL_Window* window, std::string& error);

        [[nodiscard]] virtual const char* platformType() const = 0;
        [[nodiscard]] virtual void* handle() const = 0;
        /** In the window's coordinates, from its top left. */
        virtual void setFrame(int x, int y, int width, int height) = 0;
        /** False if the window's resizing has moved the view from there. */
        [[nodiscard]] virtual bool isAt(int x, int y) const
        {
            (void)x, (void)y;
            return true;
        }
        /** A window manager may show a resized window before the host has drawn
            it, so the window keeps the view around its middle, where the stage
            will centre it. A resize the host asks for keeps its top left: it
            knows where the view stays. */
        virtual void keepTopLeft(bool keep) { (void)keep; }

        // Live presentation, while the editor's geometry changes: the view
        // stops showing and keeps painting, and the window draws
        // its images in its own frames, so that the window, the interface
        // and the editor always change together. Input does not reach the
        // editor meanwhile. Platforms that present a window's views together
        // do not need it.

        /** RGBX pixels, 32 bits each, valid until the next takeImage(). */
        struct Image
        {
            const void* pixels = nullptr;
            int width = 0;
            int height = 0;
            int pitch = 0;
            /** The first image since the view showed, with where it was in the
                window: drawn there, it can take the view's place unseen. If the
                view was partly out of sight it holds only what showed (partial):
                this part of it. */
            bool first = false;
            bool partial = false;
            int validX = 0;
            int validY = 0;
            int validWidth = 0;
            int validHeight = 0;
            int shownX = 0;
            int shownY = 0;
        };

        /** False where the platform has no live presentation. */
        [[nodiscard]] virtual bool beginLive() { return false; }
        virtual void endLive() {}
        /** The editor's newest whole image, if it has a new one. An editor
            that has been resized and not yet painted has none: its last
            image stands in for it, as a browser's layer does. */
        [[nodiscard]] virtual std::optional<Image> takeImage() { return std::nullopt; }
        /** The window can only be moved, resized and closed, not maximized or
            minimized. */
        virtual void allowOnlyMoveResizeClose() {}

        /** Stops the view showing, once the window draws the editor's image.
            False while it has no image to draw yet. */
        virtual bool hideView() { return true; }
        /** The window around the view has just been resized. */
        virtual void windowChanged() {}
        /** The editor was just given this size: images of another size, or of
            this one before it is painted, are not whole. */
        virtual void editorGiven(int width, int height) { (void)width, (void)height; }
        /** False while the editor has not painted the size it last took: it
            is not asked for another yet, however quickly they come. */
        [[nodiscard]] virtual bool settled() const { return true; }
        /** False while the editor's view would show a size not yet painted:
            live presentation goes on until it can hand the view back. */
        [[nodiscard]] virtual bool whole() const { return true; }
    };
} // namespace soundor::vst3host
