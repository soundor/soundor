#include <soundor/editor/Layout.h>

#include <algorithm>
#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::editor
{
    namespace
    {
        // `size` in the middle of `editor`.
        ui::Rect centred(ui::Size size, ui::Size editor)
        {
            return { (editor.width - size.width) / 2, (editor.height - size.height) / 2, size.width, size.height };
        }

        bool bounded(const Layout& layout)
        {
            return std::isfinite(layout.maximum.width) || std::isfinite(layout.maximum.height);
        }
    } // namespace

    Placement place(const Layout& layout, ui::Size editor)
    {
        const ui::Rect whole { 0, 0, editor.width, editor.height };
        if (! layout.resizable)
            return { .zoom = 1, .area = whole, .safeArea = std::nullopt };
        if (layout.resize == Layout::Resize::Layout)
        {
            if (! bounded(layout))
                return { .zoom = 1, .area = whole, .safeArea = std::nullopt };
            const ui::Size held { std::min(editor.width, layout.maximum.width),
                                  std::min(editor.height, layout.maximum.height) };
            if (layout.fit == Layout::Fit::Cover)
                return { .zoom = 1, .area = whole, .safeArea = centred(held, editor) };
            return { .zoom = 1, .area = centred(held, editor), .safeArea = std::nullopt };
        }

        // Resize::Scale.
        const auto designed = layout.size;
        float zoom = 1;
        if (editor.width > 0 && editor.height > 0 && designed.width > 0 && designed.height > 0)
        {
            const float most = std::min(layout.maximum.width / designed.width, layout.maximum.height / designed.height);
            zoom = std::min({ editor.width / designed.width, editor.height / designed.height, most });
        }
        if (! (zoom > 0) || ! std::isfinite(zoom))
            zoom = 1;
        if (layout.fit == Layout::Fit::Cover)
        {
            const ui::Size laidOut { editor.width / zoom, editor.height / zoom };
            return { .zoom = zoom, .area = whole, .safeArea = centred(designed, laidOut) };
        }
        return { .zoom = zoom,
                 .area = centred({ designed.width * zoom, designed.height * zoom }, editor),
                 .safeArea = std::nullopt };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::editor
