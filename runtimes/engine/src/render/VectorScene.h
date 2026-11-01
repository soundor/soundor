#pragma once

#include <soundor/ui/Svg.h>
#include <soundor/ui/Text.h>

#include <cstdint>
#include <memory>
#include <string_view>

class SkCanvas;
struct SkRect;

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    struct SvgGeometryData;

    // Created lazily for a surface that uses vector scenes. The bounded weak
    // cache shares parsed paths across roots without retaining dead geometry.
    class SvgGeometryCache
    {
    public:
        explicit SvgGeometryCache(std::uint64_t& parseCounter);
        ~SvgGeometryCache();
        SvgGeometryCache(const SvgGeometryCache&) = delete;
        SvgGeometryCache& operator=(const SvgGeometryCache&) = delete;

    private:
        friend class VectorScene;
        struct Impl;
        std::unique_ptr<Impl> impl;
        std::shared_ptr<const SvgGeometryData> path(std::string_view d);
    };

    // Immutable, validated, compiled geometry and paints. No JS/React values
    // are retained. Compilation finishes before Surface installs a scene.
    class VectorScene
    {
    public:
        static std::unique_ptr<VectorScene> compile(ui::SvgScene scene, SvgGeometryCache& cache,
                                                    const VectorScene* previous);
        ~VectorScene();
        VectorScene(const VectorScene&) = delete;
        VectorScene& operator=(const VectorScene&) = delete;
        [[nodiscard]] const ui::SvgScene& snapshot() const;
        [[nodiscard]] ui::Size naturalSize() const;
        void draw(SkCanvas& canvas, const SkRect& viewport) const;

    private:
        struct Impl;
        explicit VectorScene(std::unique_ptr<Impl> compiled);
        std::unique_ptr<Impl> impl;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
