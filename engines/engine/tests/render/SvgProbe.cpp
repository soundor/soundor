// Compiled into each plugin-shaped probe: SVG/Expat must take part in the
// export and coexistence checks even before Image exposes the document path.
#include "render/SvgDocument.h"

#include <include/core/SkCanvas.h>
#include <include/core/SkSurface.h>

#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    bool svgDocumentProbe()
    {
        constexpr std::string_view xml = "<svg width='2' height='2'><path d='M0 0h2v2H0z' fill='red'/></svg>";
        const auto document =
            soundor::render::parseSvgDocument({ reinterpret_cast<const std::uint8_t*>(xml.data()), xml.size() });
        if (document == nullptr)
            return false;
        auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(2, 2));
        if (surface == nullptr)
            return false;
        document->render(surface->getCanvas());
        SkPixmap pixels;
        return surface->peekPixels(&pixels) && pixels.getColor(1, 1) == SK_ColorRED;
    }

} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
