// Where the engine is built without Skia (the WebAssembly core, wasm/): SVG
// nodes exist and lay out at an SVG's default size, but a scene cannot be
// compiled, so setting one fails and leaves the node as it was.

#include "render/VectorScene.h"

#include <stdexcept>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    struct SvgGeometryCache::Impl
    {
    };

    struct VectorScene::Impl
    {
        ui::SvgScene scene;
    };

    SvgGeometryCache::SvgGeometryCache(std::uint64_t&) {}

    SvgGeometryCache::~SvgGeometryCache() = default;

    // By value as VectorScene.h declares it: the Skia build takes the scene over.
    std::unique_ptr<VectorScene> VectorScene::compile(ui::SvgScene, // NOLINT(performance-unnecessary-value-param)
                                                      SvgGeometryCache&, const VectorScene*)
    {
        throw std::invalid_argument("SVG scenes need Skia, which this build of the engine does not have");
    }

    VectorScene::VectorScene(std::unique_ptr<Impl> compiled) : impl(std::move(compiled)) {}

    VectorScene::~VectorScene() = default;

    const ui::SvgScene& VectorScene::snapshot() const
    {
        return impl->scene;
    }

    ui::Size VectorScene::naturalSize() const
    {
        return { 300, 150 };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
