#pragma once

#include <soundor/render/Region.h>
#include <soundor/ui/Surface.h>

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Finds what of a ui::Surface looks different from when it was last
    // drawn, in device pixels. It remembers where every node drew last time
    // (clipped as drawn) and compares: a node the surface invalidated is
    // damaged with everything in it, before and after; a node that moved or
    // resized, where it was and where it is; a node no longer drawn, where
    // it was.
    //
    // It mirrors ui::Renderer's geometry, generously: text may draw past its
    // box, and antialiasing a pixel past an edge.
    class DamageTracker
    {
    public:
        // What changed in `surface` (laid out) since the previous call, for a
        // view of `view` device pixels. Everything on the first call, or when
        // `invalidation` says so.
        [[nodiscard]] Region update(ui::Surface& surface, const ui::Surface::Invalidation& invalidation,
                                    const IntRect& view);
        // The same, split by the layers the view is drawn in: `layerOf` gives
        // the layer each node starts painting in (in paint order, so a
        // node's subtree paints in its layer and the ones after it), for
        // `layers` layers. A node's damage goes to the layers it and what is
        // in it paint in.
        [[nodiscard]] std::vector<Region> update(ui::Surface& surface, const ui::Surface::Invalidation& invalidation,
                                                 const IntRect& view,
                                                 const std::unordered_map<ui::NodeId, int>& layerOf, int layers);
        // Forgets everything: the next update() damages the whole view.
        void reset() noexcept;

    private:
        struct Record
        {
            ui::Rect box;   // its box in the view, logical pixels
            IntRect own;    // what the node itself draws, device pixels
            IntRect extent; // ... and everything in it
            // What else its drawing depends on (a scroll view's content size).
            std::uint64_t key = 0;
            std::uint32_t pass = 0;
            // The layers it and what is in it painted in.
            int first = 0;
            int last = 0;
        };
        // What visit() found of a subtree.
        struct Visited
        {
            IntRect extent;
            int last = 0;
        };

        struct Pass;
        Visited visit(Pass& pass, const ui::Node& node, float originX, float originY, const IntRect& clip);

        std::unordered_map<ui::NodeId, Record> records;
        std::uint32_t passes = 0;
        bool known = false;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
