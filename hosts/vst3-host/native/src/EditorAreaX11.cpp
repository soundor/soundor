#include "EditorArea.h"
#include "X11Library.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <utility>

namespace soundor::vst3host
{
    namespace
    {
        // How long a resized editor may take to paint before it is asked for
        // another size anyway.
        constexpr auto paintTimeout = std::chrono::milliseconds(100);
        // How long its last image stands in before the new one is shown as it
        // is: an editor can be black in all its corners.
        constexpr auto unpaintedTimeout = std::chrono::milliseconds(500);
        // A window resized this recently may be being resized still.
        constexpr auto windowSettling = std::chrono::milliseconds(200);
        // The host interface's stage (HostInterface.cpp).
        constexpr unsigned long stageColour = 0x0b0c0f;

        class X11EditorArea final : public EditorArea
        {
        public:
            X11EditorArea(const Xlib& x, Display* display, Window parent) : x_(x), display_(display), parent_(parent)
            {
                x_.setWindowBackground(display_, parent_, stageColour);
                const int screen = x_.defaultScreen(display_);
                const auto black = x_.blackPixel(display_, screen);
                window_ = x_.createSimpleWindow(display_, parent, 0, 0, 1, 1, 0, black, black);
                // Never painted by the server: what is under an editor that
                // has not drawn yet is the host's last frame, not a black box.
                x_.setWindowBackgroundPixmap(display_, window_, None);
                keepTopLeft(false);
                x_.mapWindow(display_, window_);
                x_.flush(display_);
            }

            ~X11EditorArea() override
            {
                if (live_)
                    endLive();
                if (connection_ != nullptr)
                {
                    setQuietDisplay(nullptr);
                    x_.closeDisplay(connection_);
                }
                x_.destroyWindow(display_, window_);
                x_.flush(display_);
            }

            [[nodiscard]] const char* platformType() const override { return "X11EmbedWindowID"; }
            [[nodiscard]] void* handle() const override
            {
                return reinterpret_cast<void*>(window_); // NOLINT(performance-no-int-to-ptr): an X11 id
            }

            void setFrame(int x, int y, int width, int height) override
            {
                // Still showing until a frame has drawn its image, its pixels
                // stay where they are: where it moves to has none.
                if (live_ && ! hidden_)
                {
                    heldFrame_ = { x, y, width, height };
                    return;
                }
                applyFrame(x, y, width, height);
            }

            [[nodiscard]] bool isAt(int x, int y) const override
            {
                return heldFrame_.has_value() || place() == std::pair { x, y };
            }

            void keepTopLeft(bool keep) override
            {
                // A resized window keeps its pixels, which are the last frame
                // and the editor's, and what the server fills the new part with
                // until the next frame is the stage's colour, not black. By
                // default it would discard them all, and fill the whole window.
                XSetWindowAttributes gravity {};
                gravity.bit_gravity = keep ? NorthWestGravity : CenterGravity;
                gravity.win_gravity = gravity.bit_gravity;
                x_.changeWindowAttributes(display_, parent_, CWBitGravity, &gravity);
                x_.changeWindowAttributes(display_, window_, CWWinGravity, &gravity);
            }

            bool beginLive() override
            {
                if (live_)
                    return true;
                if (! connect())
                    return false;
                Window root = 0;
                Window parent = 0;
                Window* children = nullptr;
                unsigned count = 0;
                if (x_.queryTree(connection_, window_, &root, &parent, &children, &count) == 0)
                    return false;
                editor_ = count > 0 ? children[count - 1] : 0;
                if (children != nullptr)
                    x_.free(children);
                if (editor_ == 0)
                    return false;
                // The editor keeps its size and paints into a pixmap of its
                // own, whatever the area does. Shaped to nothing, the area
                // stops clipping the window's own drawing, and stays where
                // it is: an editor tracking the pointer through a drag of its
                // own keeps its coordinates.
                live->redirectSubwindows(connection_, window_, CompositeRedirectManual);
                damage_ = live->damageCreate(connection_, editor_, XDamageReportRawRectangles);
                x_.sync(connection_, False);
                // Its pixels now are what the server could copy of what showed,
                // which may be nothing. It stays showing until it has painted
                // into its own pixmap, which it is asked to. Not if the window
                // is being resized, or has shrunk around it, as a window
                // manager's restore does: the server has let go of what was on
                // the screen, so there is nothing to keep there. Either way the
                // view goes only once a frame has drawn its image.
                askEditorToPaint();
                live_ = true;
                hidden_ = false;
                showing_ = ! clippedByWindow() && std::chrono::steady_clock::now() - windowChangedAt_ >= windowSettling;
                repainted_ = false;
                beganAt_ = std::chrono::steady_clock::now();
                firstImage_ = true;
                dirty_ = ! showing_;
                unpainted_ = false;
                width_ = 0;
                height_ = 0;
                return true;
            }

            void endLive() override
            {
                if (! live_)
                    return;
                live_ = false;
                dropImage();
                if (pixmap_ != 0)
                    x_.freePixmap(connection_, pixmap_);
                pixmap_ = 0;
                live->damageDestroy(connection_, damage_);
                // Back first: the server hands a redirected window's pixels to
                // its parent as it unredirects it.
                if (hidden_)
                {
                    keepingParentPixels(
                        [this] { live->shapeCombineMask(display_, window_, ShapeBounding, 0, 0, None, ShapeSet); });
                }
                hidden_ = false;
                showing_ = false;
                applyHeldFrame();
                x_.sync(display_, False);
                live->unredirectSubwindows(connection_, window_, CompositeRedirectManual);
                x_.sync(connection_, False);
            }

            std::optional<Image> takeImage() override
            {
                if (! live_)
                    return std::nullopt;
                x_.sync(connection_, False);
                XWindowAttributes attributes {};
                if (x_.getWindowAttributes(connection_, editor_, &attributes) == 0
                    || attributes.map_state != IsViewable)
                    return std::nullopt;
                if (given_)
                {
                    // Not there yet: its pixmap is the old size, part painted.
                    if ((attributes.width != given_->first || attributes.height != given_->second)
                        && std::chrono::steady_clock::now() - givenAt_ < paintTimeout)
                        return std::nullopt;
                    given_.reset();
                }
                if (attributes.width != width_ || attributes.height != height_)
                {
                    // Each size has its own pixmap.
                    if (pixmap_ != 0)
                        x_.freePixmap(connection_, pixmap_);
                    pixmap_ = live->nameWindowPixmap(connection_, editor_);
                    unpainted_ = width_ != 0;
                    resizedAt_ = std::chrono::steady_clock::now();
                    width_ = attributes.width;
                    height_ = attributes.height;
                }
                while (x_.pending(connection_) > 0)
                {
                    XEvent event {};
                    x_.nextEvent(connection_, &event);
                    if (event.type != damageEvent_ + XDamageNotify)
                        continue;
                    dirty_ = true;
                    const auto& notify = reinterpret_cast<const XDamageNotifyEvent&>(event);
                    if (notify.area.x == 0 && notify.area.y == 0 && notify.area.width >= width_
                        && notify.area.height >= height_)
                        repainted_ = true;
                }
                if (showing_)
                {
                    // Whole, or as whole as it will get.
                    if (! repainted_ && windowChangedAt_ < beganAt_
                        && std::chrono::steady_clock::now() - beganAt_ < paintTimeout)
                        return std::nullopt;
                    dirty_ = true;
                    firstImage_ = ! repainted_;
                }
                if (! dirty_)
                    return std::nullopt;
                dirty_ = false;
                live->damageSubtract(connection_, damage_, None, None);
                dropImage();
                image_ = x_.getImage(connection_, pixmap_, 0, 0, static_cast<unsigned>(width_),
                                     static_cast<unsigned>(height_), AllPlanes, ZPixmap);
                if (image_ == nullptr)
                    return std::nullopt;
                // A pixmap's image has no masks: the window's visual has them.
                if (image_->bits_per_pixel != 32 || attributes.visual->red_mask != 0xff0000
                    || attributes.visual->blue_mask != 0xff)
                    return std::nullopt;
                // A resized window's new pixmap is zeros, and the server's
                // clearing it counts as damage: not painted while a corner or
                // the middle is still zero. An editor changing its scale can
                // leave zeros again in a later frame, so this goes on for a while.
                if (! painted() && std::chrono::steady_clock::now() - resizedAt_ < unpaintedTimeout)
                {
                    dirty_ = true;
                    return std::nullopt;
                }
                unpainted_ = false;
                Image result { image_->data, width_, height_, image_->bytes_per_line };
                showing_ = false;
                if (std::exchange(firstImage_, false))
                {
                    // Redirecting keeps what showed, and the window may already
                    // have shrunk: a window manager's restore starts that way.
                    result.first = true;
                    XWindowAttributes outer {};
                    if (x_.getWindowAttributes(display_, parent_, &outer) != 0)
                    {
                        const auto [x, y] = place();
                        result.validX = std::clamp(-x, 0, width_ - 1);
                        result.validY = std::clamp(-y, 0, height_ - 1);
                        result.validWidth = std::clamp(outer.width - x - result.validX, 1, width_ - result.validX);
                        result.validHeight = std::clamp(outer.height - y - result.validY, 1, height_ - result.validY);
                        result.shownX = x + result.validX;
                        result.shownY = y + result.validY;
                        result.partial = result.validWidth < width_ || result.validHeight < height_;
                    }
                }
                return result;
            }

            void allowOnlyMoveResizeClose() override
            {
                // As Motif defined it: flags (functions), functions (resize,
                // move, close), decorations, input mode, status.
                const std::array<unsigned long, 5> hints { 1, 2 | 4 | 32, 0, 0, 0 };
                const Atom property = x_.internAtom(display_, "_MOTIF_WM_HINTS", False);
                x_.changeProperty(display_, parent_, property, property, 32, PropModeReplace,
                                  reinterpret_cast<const unsigned char*>(hints.data()), hints.size());
            }

            bool hideView() override
            {
                if (! live_ || showing_)
                    return false;
                if (hidden_)
                    return true;
                // The editor keeps its coordinates: shaped to nothing, the area
                // stays where it is.
                hidden_ = true;
                keepingParentPixels(
                    [this] {
                        live->shapeCombineRectangles(display_, window_, ShapeBounding, 0, 0, nullptr, 0, ShapeSet,
                                                     Unsorted);
                    });
                applyHeldFrame();
                x_.sync(display_, False);
                return true;
            }

            [[nodiscard]] bool awaitingEditor() const { return live_ && showing_; }

            void windowChanged() override { windowChangedAt_ = std::chrono::steady_clock::now(); }

            void editorGiven(int width, int height) override
            {
                if (! live_ || (width == width_ && height == height_))
                    return;
                given_ = { width, height };
                givenAt_ = std::chrono::steady_clock::now();
            }

            [[nodiscard]] bool whole() const override
            {
                const auto now = std::chrono::steady_clock::now();
                if (awaitingEditor() || (given_ && now - givenAt_ < unpaintedTimeout))
                    return false;
                return ! unpainted_ || now - resizedAt_ >= unpaintedTimeout;
            }

            [[nodiscard]] bool settled() const override
            {
                const auto now = std::chrono::steady_clock::now();
                if (awaitingEditor() || (given_ && now - givenAt_ < paintTimeout))
                    return false;
                return ! unpainted_ || now - resizedAt_ >= paintTimeout;
            }

        private:
            /** A connection of its own: redirection ends with it, and SDL
                does not see its events. */
            bool connect()
            {
                if (connection_ != nullptr)
                    return true;
                if (unavailable_)
                    return false;
                unavailable_ = true;
                live = loadXLive();
                if (live == nullptr)
                    return false;
                connection_ = x_.openDisplay(x_.displayString(display_));
                if (connection_ == nullptr)
                    return false;
                int event = 0;
                int error = 0;
                if (live->compositeQueryExtension(connection_, &event, &error) == 0
                    || live->damageQueryExtension(connection_, &damageEvent_, &error) == 0
                    || live->shapeQueryExtension(connection_, &event, &error) == 0)
                {
                    x_.closeDisplay(connection_);
                    connection_ = nullptr;
                    return false;
                }
                setQuietDisplay(connection_);
                return true;
            }

            void applyFrame(int x, int y, int width, int height)
            {
                const bool moved = ! isAt(x, y);
                x_.moveResizeWindow(display_, window_, x, y, static_cast<unsigned>(std::max(width, 1)),
                                    static_cast<unsigned>(std::max(height, 1)));
                if (moved)
                    tellEditorItMoved();
                x_.flush(display_);
            }

            void applyHeldFrame()
            {
                if (const auto frame = std::exchange(heldFrame_, std::nullopt))
                    applyFrame((*frame)[0], (*frame)[1], (*frame)[2], (*frame)[3]);
            }

            /** Showing or hiding the view exposes the window under it, which
                must not fill with its background: what is there stays until
                the next frame. */
            template <typename Change>
            void keepingParentPixels(Change change)
            {
                x_.setWindowBackgroundPixmap(display_, parent_, None);
                change();
                x_.setWindowBackground(display_, parent_, stageColour);
            }

            /** Where the view is now, which the window's gravity decides too. */
            [[nodiscard]] std::pair<int, int> place() const
            {
                XWindowAttributes attributes {};
                x_.getWindowAttributes(display_, window_, &attributes);
                return { attributes.x, attributes.y };
            }

            [[nodiscard]] bool clippedByWindow() const
            {
                XWindowAttributes outer {};
                XWindowAttributes editor {};
                if (x_.getWindowAttributes(display_, parent_, &outer) == 0
                    || x_.getWindowAttributes(display_, editor_, &editor) == 0)
                    return true;
                const auto [x, y] = place();
                return x < 0 || y < 0 || x + editor.width > outer.width || y + editor.height > outer.height;
            }

            void askEditorToPaint()
            {
                XWindowAttributes attributes {};
                if (x_.getWindowAttributes(display_, editor_, &attributes) == 0)
                    return;
                XEvent event {};
                event.xexpose.type = Expose;
                event.xexpose.window = editor_;
                event.xexpose.width = attributes.width;
                event.xexpose.height = attributes.height;
                x_.sendEvent(display_, editor_, False, ExposureMask, &event);
                x_.flush(display_);
            }

            /** The server tells a window of its own moves only, and an editor
                keeps its place on the screen from that (a drag of its own reads
                the pointer's screen position): as a window manager does for a
                window it moves, a synthetic ConfigureNotify. */
            void tellEditorItMoved()
            {
                Window root = 0;
                Window parent = 0;
                Window* children = nullptr;
                unsigned count = 0;
                if (x_.queryTree(display_, window_, &root, &parent, &children, &count) == 0)
                    return;
                for (unsigned index = 0; index < count; ++index)
                {
                    XWindowAttributes attributes {};
                    Window child = 0;
                    int rootX = 0;
                    int rootY = 0;
                    if (x_.getWindowAttributes(display_, children[index], &attributes) == 0
                        || x_.translateCoordinates(display_, children[index], root, 0, 0, &rootX, &rootY, &child) == 0)
                        continue;
                    XEvent event {};
                    event.xconfigure.type = ConfigureNotify;
                    event.xconfigure.event = children[index];
                    event.xconfigure.window = children[index];
                    event.xconfigure.x = rootX;
                    event.xconfigure.y = rootY;
                    event.xconfigure.width = attributes.width;
                    event.xconfigure.height = attributes.height;
                    x_.sendEvent(display_, children[index], False, StructureNotifyMask, &event);
                }
                if (children != nullptr)
                    x_.free(children);
            }

            [[nodiscard]] bool painted() const
            {
                auto zero = [this](int x, int y)
                {
                    const char* row = image_->data + static_cast<std::ptrdiff_t>(y) * image_->bytes_per_line;
                    uint32_t pixel = 0;
                    std::memcpy(&pixel, row + static_cast<std::ptrdiff_t>(x) * 4, sizeof pixel);
                    return (pixel & 0xffffffU) == 0;
                };
                return ! (zero(0, 0) || zero(width_ - 1, 0) || zero(0, height_ - 1) || zero(width_ - 1, height_ - 1)
                          || zero(width_ / 2, height_ / 2));
            }

            void dropImage()
            {
                if (image_ != nullptr)
                    image_->f.destroy_image(image_);
                image_ = nullptr;
            }

            const Xlib& x_;
            const XLive* live = nullptr;
            Display* display_;
            Display* connection_ = nullptr;
            Window parent_ = 0;
            Window window_ = 0;
            Window editor_ = 0;
            Pixmap pixmap_ = 0;
            Damage damage_ = 0;
            XImage* image_ = nullptr;
            int damageEvent_ = 0;
            int width_ = 0;
            int height_ = 0;
            std::chrono::steady_clock::time_point resizedAt_;
            std::optional<std::pair<int, int>> given_;
            std::chrono::steady_clock::time_point givenAt_;
            bool unavailable_ = false;
            bool live_ = false;
            bool firstImage_ = false;
            /** Live, with the view still showing until the editor has painted. */
            bool showing_ = false;
            /** Shaped to nothing: the window draws its image. */
            bool hidden_ = false;
            std::optional<std::array<int, 4>> heldFrame_;
            bool repainted_ = false;
            std::chrono::steady_clock::time_point beganAt_;
            std::chrono::steady_clock::time_point windowChangedAt_;
            bool dirty_ = false;
            bool unpainted_ = false;
        };
    } // namespace

    std::unique_ptr<EditorArea> EditorArea::create(SDL_Window* window, std::string& error)
    {
        const Xlib* x = loadXlib(error);
        if (x == nullptr)
            return nullptr;
        const SDL_PropertiesID properties = SDL_GetWindowProperties(window);
        auto* display =
            static_cast<Display*>(SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_X11_DISPLAY_POINTER, nullptr));
        const auto parent =
            static_cast<Window>(SDL_GetNumberProperty(properties, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0));
        if (display == nullptr || parent == 0)
        {
            error = "the host interface's window is not an X11 window";
            return nullptr;
        }
        return std::make_unique<X11EditorArea>(*x, display, parent);
    }
} // namespace soundor::vst3host
