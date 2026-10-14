#pragma once
#include <soundor/ui/Renderer.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    class DebugOverlay
    {
    public:
        const Frame& append(const Frame& content, ui::Surface& surface, ui::Renderer& painter);

    private:
        std::unique_ptr<RasterSurface> pixels;
        LayerId layer = 0;
        ui::NodeId node = ui::noNode;
        struct Placement
        {
            ui::Rect frame;
            Transform matrix;
            std::array<float, 8> borderAndRadius {};
            bool hidden = false;
            friend bool operator==(const Placement&, const Placement&) = default;
        };
        std::vector<Placement> geometry;
        float scale = 0;
        Frame frame;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
