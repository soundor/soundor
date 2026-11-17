#include "gpu/Presentation.h"
#include "gpu/linux/Xcb.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        const Xcb& xcb()
        {
            static const Xcb functions;
            return functions;
        }

        using Connection = std::unique_ptr<xcb_connection_t, decltype(&xcb_disconnect)>;

        bool checked(const Xcb& x, xcb_connection_t* connection, xcb_void_cookie_t request)
        {
            auto* error = x.request_check(connection, request);
            const bool ok = error == nullptr && x.connection_has_error(connection) == 0;
            std::free(error);
            return ok;
        }

        class ChildWindowPresentation final : public Presentation
        {
        public:
            ChildWindowPresentation(const Xcb& api, Connection connection, xcb_window_t child)
                : functions(api), display(std::move(connection)), window(child)
            {
            }

            // Disconnecting releases our child and colormap even if the host
            // has already destroyed the parent. No process-wide X error handler.
            [[nodiscard]] void* nativeWindow() const noexcept override
            {
                // EGL transports an XID through the platform-neutral pointer slot.
                const auto id = static_cast<std::uintptr_t>(window);
                return reinterpret_cast<void*>(id); // NOLINT(performance-no-int-to-ptr)
            }

            void setBounds(float x, float y, float width, float height, float) override
            {
                const auto left = static_cast<int>(std::lround(x));
                const auto top = static_cast<int>(std::lround(y));
                const auto w = std::clamp(static_cast<int>(std::lround(x + width)) - left, 1, 65535);
                const auto h = std::clamp(static_cast<int>(std::lround(y + height)) - top, 1, 65535);
                if (left == lastX && top == lastY && w == lastWidth && h == lastHeight)
                    return;
                const std::array<std::uint32_t, 4> values { static_cast<std::uint32_t>(left),
                                                            static_cast<std::uint32_t>(top),
                                                            static_cast<std::uint32_t>(w),
                                                            static_cast<std::uint32_t>(h) };
                // ANGLE queries geometry on another connection: finish the X request first.
                working =
                    checked(functions, display.get(),
                            functions.configure_window_checked(display.get(), window,
                                                               XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y
                                                                   | XCB_CONFIG_WINDOW_WIDTH | XCB_CONFIG_WINDOW_HEIGHT,
                                                               values.data()))
                    && working;
                lastX = left;
                lastY = top;
                lastWidth = w;
                lastHeight = h;
            }

            void setVisible(bool visible) override
            {
                if (visible == shown)
                    return;
                working = checked(functions, display.get(),
                                  visible ? functions.map_window_checked(display.get(), window)
                                          : functions.unmap_window_checked(display.get(), window))
                          && working;
                shown = visible;
            }

            [[nodiscard]] bool healthy() const noexcept override { return working; }

        private:
            const Xcb& functions;
            Connection display;
            xcb_window_t window;
            int lastX = 0, lastY = 0, lastWidth = 1, lastHeight = 1;
            bool shown = false;
            bool working = true;
        };
    } // namespace

    std::unique_ptr<Presentation> createPresentation(void* view, std::string* failure)
    {
        const auto fail = [&](const char* reason) -> std::unique_ptr<Presentation>
        {
            if (failure != nullptr)
                *failure = reason;
            return nullptr;
        };
        if (view == nullptr)
            return fail("no X11 parent window to present in");
        const auto& x = xcb();
        if (! x.available)
            return fail("GPU presentation needs libxcb.so.1 and libxcb-shape.so.0");
        Connection display(x.connect(nullptr, nullptr), x.disconnect);
        if (display == nullptr || x.connection_has_error(display.get()) != 0)
            return fail("no X11 display for GPU presentation");
        auto* version = x.shape_query_version_reply(display.get(), x.shape_query_version(display.get()), nullptr);
        const bool inputShape =
            version != nullptr
            && (version->major_version > 1 || (version->major_version == 1 && version->minor_version >= 1));
        std::free(version);
        if (! inputShape)
            return fail("GPU presentation needs X Shape 1.1 for input transparency");
        const auto parent = static_cast<xcb_window_t>(reinterpret_cast<std::uintptr_t>(view));
        auto* tree = x.query_tree_reply(display.get(), x.query_tree(display.get(), parent), nullptr);
        if (tree == nullptr)
            return fail("could not inspect the X11 parent window");
        const xcb_window_t root = tree->root;
        std::free(tree);
        // ANGLE's XCB backend uses the first screen's visual.
        const auto screens = x.setup_roots_iterator(x.get_setup(display.get()));
        if (screens.rem == 0 || screens.data->root != root)
            return fail("GPU presentation needs a parent on the default X11 screen");
        const auto* screen = screens.data;
        const xcb_colormap_t colors = x.generate_id(display.get());
        if (! checked(
                x, display.get(),
                x.create_colormap_checked(display.get(), XCB_COLORMAP_ALLOC_NONE, colors, root, screen->root_visual)))
            return fail("could not create the X11 rendering colormap");
        const xcb_window_t child = x.generate_id(display.get());
        // Explicit border and colormap also work with an ARGB parent of a different depth.
        const std::array<std::uint32_t, 2> attributes { 0, colors };
        if (! checked(x, display.get(),
                      x.create_window_checked(display.get(), screen->root_depth, child, parent, 0, 0, 1, 1, 0,
                                              XCB_WINDOW_CLASS_INPUT_OUTPUT, screen->root_visual,
                                              XCB_CW_BORDER_PIXEL | XCB_CW_COLORMAP, attributes.data())))
            return fail("could not create the X11 rendering child window");
        // Empty input shape: the parent retains pointer, wheel, keyboard and focus handling.
        if (! checked(x, display.get(),
                      x.shape_rectangles_checked(display.get(), XCB_SHAPE_SO_SET, XCB_SHAPE_SK_INPUT,
                                                 XCB_CLIP_ORDERING_UNSORTED, child, 0, 0, 0, nullptr)))
            return fail("could not make the X11 rendering child input-transparent");
        return std::make_unique<ChildWindowPresentation>(x, std::move(display), child);
    }

    bool presentationAvailable() noexcept
    {
        return xcb().available;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
