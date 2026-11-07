#pragma once

#include <soundor/Abi.h>
#include <soundor/ui/Renderer.h>

#include <memory>
#include <unordered_map>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Selective subtree isolation. Used only when visual transforms or
    // animation overrides need it; the ordinary damage path stays intact.
    class AnimationRenderer
    {
    public:
        explicit AnimationRenderer(ui::Renderer& renderer) : painter(renderer) {}
        [[nodiscard]] static bool needed(const ui::Node& node);
        const Frame& update(ui::Surface& surface, double seconds, const gpu::Device* device);

    private:
        struct Segment
        {
            LayerId id = newLayerId();
            RasterSurface pixels;
            IntRect bounds;
        };
        struct Hole
        {
            ui::NodeId node = ui::noNode;
            Transform transform;
            bool gpu = false;
        };
        struct Group
        {
            LayerId id = newLayerId();
            LayerId gpuId = newLayerId();
            Frame frame;
            IntRect extent;
            std::vector<ui::NodeId> holes;
            std::vector<Segment> segments;
            std::unordered_map<ui::NodeId, std::pair<ui::Rect, std::uint64_t>> layout;
            std::vector<Hole> nextHoles;
            std::vector<ui::NodeId> nextIds;
            std::vector<IntRect> painting;
            ui::Style style;
            bool initialized = false;
            std::uint64_t used = 0;
            std::uint64_t cacheBytes = 0;
        };
        Group& build(ui::Surface& surface, const ui::Node& root, double seconds, const gpu::Device* device,
                     const ui::Surface::Invalidation& invalidation, FrameStatistics& statistics);
        ui::Renderer& painter;
        std::unordered_map<ui::NodeId, std::unique_ptr<Group>> groups;
        const gpu::Device* previousDevice = nullptr;
        std::uint64_t generation = 0;
        Frame frame;
        RasterSurface fallback;
        LayerId fallbackId = newLayerId();
        std::uint64_t cachedBytes = 0;
        bool budgetFallback = false;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
