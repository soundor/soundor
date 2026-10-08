#pragma once

#include <soundor/Config.h>
#include <soundor/render/Frame.h>

#include <memory>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // What a compositor can do, for choosing how to render and for
    // diagnostics.
    struct Capabilities
    {
        // Composites on the GPU (CPU layers are uploaded as textures).
        bool gpu = false;
        // E.g. "Skia raster", "ANGLE / Metal".
        std::string backend;
        // The GPU device it draws on: GpuContent on this device is drawn as
        // it is; any other is read back by the frame's producer first.
        const gpu::Device* device = nullptr;
    };

    // What the last composite() did: zero work means nothing changed.
    struct CompositorStatistics
    {
        int layersComposited = 0;
        long long pixelsComposited = 0;
        // Bytes of CPU pixels sent to the GPU.
        long long bytesUploaded = 0;
        int textureAllocations = 0;
        int drawCalls = 0;
        // GPU pixels read back to the CPU.
        int readbacks = 0;
    };

    // Puts a view's layers together and presents the result: the last step
    // of a frame. Owned by the backend (it outlives a reloaded UI) and used
    // on the UI thread only.
    class Compositor
    {
    public:
        virtual ~Compositor() = default;

        [[nodiscard]] virtual Capabilities capabilities() const = 0;
        // Composites and presents `frame`, drawing again only what changed
        // since the previous call (frame.damage, and layers that moved,
        // appeared or went away).
        virtual void composite(const Frame& frame) = 0;
        [[nodiscard]] virtual const CompositorStatistics& statistics() const noexcept = 0;
    };

    // Where a CPU compositor puts its result: pixels the platform shows.
    class RasterTarget
    {
    public:
        virtual ~RasterTarget() = default;

        struct Pixels
        {
            Bitmap bitmap;
            // Whether the pixels are still those of the previous present():
            // false when they were (re)allocated, so everything is drawn.
            bool preserved = false;
        };

        // The pixels to composite into, at `width`×`height`.
        virtual Pixels acquire(int width, int height) = 0;
        // Shows what acquire() returned, of which `damage` changed.
        virtual void present(const Region& damage) = 0;
    };

    // Composites on the CPU, with Skia, into a RasterTarget. It is the
    // fallback that always works, and draws only what changed.
    class RasterCompositor final : public Compositor
    {
    public:
        explicit RasterCompositor(RasterTarget& target);
        ~RasterCompositor() override;

        RasterCompositor(const RasterCompositor&) = delete;
        RasterCompositor& operator=(const RasterCompositor&) = delete;

        [[nodiscard]] Capabilities capabilities() const override;
        void composite(const Frame& frame) override;
        [[nodiscard]] const CompositorStatistics& statistics() const noexcept override { return stats; }

    private:
        RasterTarget& output;
        // The layers last composited, to see which moved or went away.
        std::vector<Layer> previous;
        CompositorStatistics stats;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
