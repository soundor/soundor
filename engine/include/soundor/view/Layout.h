#pragma once

// Where a plugin's UI goes in its editor: the rules of soundor.config's
// `editor` (resize, fit, the maximum size), the same in every runtime's
// editor. Pure: sizes in, a placement out.

#include <soundor/Abi.h>
#include <soundor/ui/Input.h>
#include <soundor/ui/Surface.h>
#include <soundor/ui/Text.h>

#include <cstdint>
#include <limits>
#include <optional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::view
{
    // soundor.config's `editor`, as far as placing the UI goes.
    struct Layout
    {
        enum class Resize : std::uint8_t
        {
            // Resizing lays the UI out again at the editor's size.
            Layout,
            // Resizing zooms the UI, laid out at `size` (the editor's
            // configured size).
            Scale,
        };
        enum class Fit : std::uint8_t
        {
            // Beyond what the UI fills, bands around it.
            Contain,
            // The UI is laid out over the whole editor; the safe area is the
            // part always shown whole.
            Cover,
        };

        // The configured size (editor.width × editor.height), logical pixels.
        ui::Size size { 800, 600 };
        bool resizable = false;
        Resize resize = Resize::Layout;
        Fit fit = Fit::Contain;
        // The editor's maximum size; infinity on a side without one.
        ui::Size maximum { std::numeric_limits<float>::infinity(), std::numeric_limits<float>::infinity() };
    };

    // What the UI is in an editor of a given size.
    struct Placement
    {
        // Logical pixels of the editor per pixel of the UI's layout: 1, or
        // with an editor that scales, its size over the configured one.
        float zoom = 1;
        // Where the UI is drawn, in the editor's logical pixels.
        ui::Rect area;
        // The part of the layout always shown whole, in its pixels: all of it
        // (nullopt), or less with fit 'cover'.
        std::optional<ui::Rect> safeArea;

        // The size the UI is laid out at.
        [[nodiscard]] ui::Size layoutSize() const noexcept { return { area.width / zoom, area.height / zoom }; }
        // An editor position in the layout, and back.
        [[nodiscard]] ui::Point toLayout(ui::Point editor) const noexcept
        {
            return { (editor.x - area.x) / zoom, (editor.y - area.y) / zoom };
        }
        [[nodiscard]] ui::Point toEditor(ui::Point layout) const noexcept
        {
            return { layout.x * zoom + area.x, layout.y * zoom + area.y };
        }

        friend bool operator==(const Placement&, const Placement&) = default;
    };

    // The UI in an editor `editor` logical pixels in size:
    //
    // - A fixed editor: a zoom of 1, the whole editor, all of it safe.
    // - One that lays out again: the whole editor laid out, up to its
    //   maximum. Beyond it (a host that sets a larger window regardless),
    //   'contain' lays the UI out at the maximum in the middle, with bands
    //   around it; 'cover' lays it out over the whole editor, the maximum in
    //   the middle being the safe area.
    // - One that scales: the editor's size over the configured one, the
    //   smaller of the two where a host does not keep the aspect ratio, and
    //   never beyond the zoom the maximum allows. 'contain' draws the layout
    //   at that zoom in the middle; 'cover' lays it out over the whole
    //   editor, the configured size in its middle being the safe area.
    //   Nothing is stretched.
    [[nodiscard]] Placement place(const Layout& layout, ui::Size editor);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::view
