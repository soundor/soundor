#pragma once

#include "render/Damage.h"

#include <soundor/render/Frame.h>
#include <soundor/ui/Renderer.h>
#include <soundor/ui/Surface.h>

#include <cstdint>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Turns a view's ui::Surface into a Frame for a compositor: plans its
    // layers and keeps their CPU rasterization current, drawing only what
    // changed since the previous frame.
    //
    // The UI is CPU layers. A canvas drawn on the GPU (WebGL) on the
    // compositor's device becomes a layer of its own, its image shown as it
    // is, and the UI is cut into one CPU layer below it and one above (per
    // such canvas), so that a canvas drawing every frame redraws none of
    // them. Where the compositor cannot show a GPU canvas (another device, a
    // CPU compositor, a clip a layer cannot have), its image is read back
    // into its pixels and drawn on the CPU like any canvas.
    class ViewRenderer
    {
    public:
        explicit ViewRenderer(ui::Renderer& renderer) : painter(renderer) {}

        // The frame for `surface` as it is now, for a compositor drawing GPU
        // images on `gpuDevice` (null: none). It and the pixels it points to
        // stay valid until the next call.
        const Frame& update(ui::Surface& surface, double seconds, const gpu::Device* gpuDevice = nullptr);

        // Reads back the GPU canvases' new images into their pixels, for
        // drawing the surface on the CPU; returns how many were read.
        static int readBackCanvases(ui::Surface& surface);

    private:
        // A GPU canvas shown as a layer of its own.
        struct Promoted
        {
            ui::NodeId node = ui::noNode;
            std::shared_ptr<GpuImage> image;
            Layer layer;
        };
        // One CPU layer of the UI: what paints between two promoted canvases.
        struct Segment
        {
            LayerId id = newLayerId();
            RasterSurface pixels;
        };

        void promote(ui::Surface& surface, const gpu::Device* gpuDevice);

        ui::Renderer& painter;
        DamageTracker damage;
        std::vector<Segment> segments { 1 };
        std::vector<Promoted> promoted;
        std::vector<ui::NodeId> holes;
        // Canvas layers' ids by node, kept while promoted.
        std::vector<std::pair<ui::NodeId, LayerId>> canvasLayers;
        std::uint64_t revision = 0;
        Frame frame;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
