#include "render/DrawingSurface.h"

#include <soundor/ui/Surface.h>

#include <include/core/SkCanvas.h>
#include <include/core/SkColorSpace.h>
#include <include/core/SkPixmap.h>

#if defined(SK_GANESH) && SOUNDOR_HAS_GANESH
    #include "gpu/DrawingContext.h"

    #include <include/gpu/ganesh/GrBackendSurface.h>
    #include <include/gpu/ganesh/GrDirectContext.h>
    #include <include/gpu/ganesh/SkSurfaceGanesh.h>
    #include <include/gpu/ganesh/gl/GrGLAssembleInterface.h>
    #include <include/gpu/ganesh/gl/GrGLBackendSurface.h>
    #include <include/gpu/ganesh/gl/GrGLDirectContext.h>
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
#if defined(SK_GANESH) && SOUNDOR_HAS_GANESH
    struct GaneshContext::Scope::Impl
    {
        std::unique_ptr<gpu::CurrentContext> current;
    };
    struct GaneshContext::Impl
    {
        std::shared_ptr<gpu::DrawingContext> driver;
        sk_sp<GrDirectContext> context;
    };
    struct GaneshSurface::Impl
    {
        std::shared_ptr<GaneshContext> owner;
        std::shared_ptr<gpu::DrawingTexture> texture;
        sk_sp<SkSurface> surface;
    };

    std::shared_ptr<GaneshContext> GaneshContext::create(std::shared_ptr<gpu::Device> device)
    {
        auto driver = gpu::DrawingContext::create(std::move(device));
        if (! driver)
            return nullptr;
        const auto current = driver->makeCurrent();
        if (! current)
            return nullptr;
        auto interface = GrGLMakeAssembledGLESInterface(
            nullptr, [](void*, const char* name)
            { return reinterpret_cast<GrGLFuncPtr>(gpu::DrawingContext::procedure(name)); });
        if (! interface)
            return nullptr;
        auto context = GrDirectContexts::MakeGL(std::move(interface));
        if (! context)
            return nullptr;
        context->setResourceCacheLimit(64ULL * 1024 * 1024);
        auto result = std::shared_ptr<GaneshContext>(new GaneshContext());
        result->impl->driver = std::move(driver);
        result->impl->context = std::move(context);
        return result;
    }
    GaneshContext::~GaneshContext()
    {
        const auto current = makeCurrent();
        if (! current || ! impl->driver->healthy())
            impl->context->abandonContext();
        impl->context.reset();
    }
    const gpu::Device* GaneshContext::device() const
    {
        return impl->driver->device();
    }
    std::unique_ptr<GaneshContext::Scope> GaneshContext::makeCurrent() const
    {
        auto current = impl->driver->makeCurrent();
        if (! current)
            return nullptr;
        if (impl->driver->takeStateChanged())
            impl->context->resetContext();
        auto result = std::make_unique<Scope>();
        result->impl->current = std::move(current);
        return result;
    }
    bool GaneshContext::healthy() const
    {
        return impl->driver->healthy() && ! impl->context->abandoned();
    }
    void GaneshContext::resetState()
    {
        impl->driver->takeStateChanged();
        impl->context->resetContext();
    }

    std::shared_ptr<GaneshSurface> GaneshSurface::create(std::shared_ptr<GaneshContext> context, int width, int height)
    {
        const auto current = context->makeCurrent();
        if (! current || ! context->healthy())
            return nullptr;
        std::shared_ptr<gpu::DrawingTexture> texture =
            gpu::DrawingTexture::create(context->impl->driver, width, height);
        if (! texture)
            return nullptr;
        context->resetState();
        // GLES RGBA8, with GL's bottom-left origin as GpuContent requires.
        GrGLTextureInfo info { 0x0DE1, texture->texture(), 0x8058, skgpu::Protected::kNo };
        auto backend = GrBackendTextures::MakeGL(width, height, skgpu::Mipmapped::kNo, info);
        auto surface = SkSurfaces::WrapBackendTexture(
            context->impl->context.get(), backend, kBottomLeft_GrSurfaceOrigin, 0, kRGBA_8888_SkColorType, nullptr,
            nullptr, [](void* owner) { delete static_cast<std::shared_ptr<gpu::DrawingTexture>*>(owner); },
            new std::shared_ptr<gpu::DrawingTexture>(texture));
        if (! surface)
            return nullptr;
        auto result = std::shared_ptr<GaneshSurface>(new GaneshSurface());
        result->impl->owner = std::move(context);
        result->impl->texture = std::move(texture);
        result->impl->surface = std::move(surface);
        result->begin().clear(SK_ColorTRANSPARENT);
        result->publish();
        return result;
    }
    GaneshSurface::~GaneshSurface()
    {
        const auto current = impl->owner->makeCurrent();
        if (! current || ! impl->owner->healthy())
            impl->owner->impl->context->abandonContext();
        impl->surface.reset();
        impl->texture.reset();
    }
    SkCanvas& GaneshSurface::begin()
    {
        impl->texture->beginWrite();
        return *impl->surface->getCanvas();
    }
    void GaneshSurface::publish()
    {
        impl->owner->impl->context->flushAndSubmit(impl->surface.get(), GrSyncCpu::kNo);
        impl->texture->publish();
    }
    sk_sp<SkImage> GaneshSurface::snapshot()
    {
        return impl->surface->makeImageSnapshot();
    }
    std::shared_ptr<GpuImage> GaneshSurface::image() const
    {
        return impl->texture->image();
    }
    GaneshContext& GaneshSurface::context() const
    {
        return *impl->owner;
    }
    bool GaneshSurface::readPixels(const SkImageInfo& info, void* pixels, std::size_t rowBytes, int x, int y)
    {
        impl->owner->resetState();
        return impl->surface->readPixels(info, pixels, rowBytes, x, y);
    }
    bool GaneshSurface::writePixels(const SkPixmap& pixels, int x, int y)
    {
        begin();
        impl->surface->writePixels(pixels, x, y);
        publish();
        return true;
    }
#else
    struct GaneshContext::Scope::Impl
    {
    };
    struct GaneshContext::Impl
    {
    };
    struct GaneshSurface::Impl
    {
    };
    std::shared_ptr<GaneshContext> GaneshContext::create(std::shared_ptr<gpu::Device>)
    {
        return nullptr;
    }
    GaneshContext::~GaneshContext() = default;
    const gpu::Device* GaneshContext::device() const
    {
        return nullptr;
    }
    std::unique_ptr<GaneshContext::Scope> GaneshContext::makeCurrent() const
    {
        return nullptr;
    }
    bool GaneshContext::healthy() const
    {
        return false;
    }
    void GaneshContext::resetState() {}
    std::shared_ptr<GaneshSurface> GaneshSurface::create(std::shared_ptr<GaneshContext>, int, int)
    {
        return nullptr;
    }
    GaneshSurface::~GaneshSurface() = default;
    SkCanvas& GaneshSurface::begin()
    {
        std::terminate();
    }
    void GaneshSurface::publish() {}
    sk_sp<SkImage> GaneshSurface::snapshot()
    {
        return nullptr;
    }
    std::shared_ptr<GpuImage> GaneshSurface::image() const
    {
        return nullptr;
    }
    GaneshContext& GaneshSurface::context() const
    {
        std::terminate();
    }
    bool GaneshSurface::readPixels(const SkImageInfo&, void*, std::size_t, int, int)
    {
        return false;
    }
    bool GaneshSurface::writePixels(const SkPixmap&, int, int)
    {
        return false;
    }
#endif
    GaneshContext::Scope::Scope() : impl(std::make_unique<Impl>()) {}
    GaneshContext::Scope::~Scope() = default;
    GaneshContext::GaneshContext() : impl(std::make_unique<Impl>()) {}
    GaneshSurface::GaneshSurface() : impl(std::make_unique<Impl>()) {}

    void flushCanvas(const ui::CanvasBuffer& buffer)
    {
        if (! buffer.drawingSurface || ! buffer.gpuDrawn)
            return;
        auto& context = buffer.drawingSurface->context();
        const auto current = context.makeCurrent();
        if (current && context.healthy())
            buffer.drawingSurface->publish();
    }

    bool readCanvasPixels(ui::CanvasBuffer& buffer)
    {
        if (! buffer.drawingSurface)
            return true;
        flushCanvas(buffer);
        return buffer.gpuImage && buffer.gpuImage->read(buffer.pixels);
    }

    sk_sp<SkImage> canvasImage(const ui::CanvasBuffer& buffer, bool onGpu, bool copy)
    {
        if (onGpu && buffer.drawingSurface)
            return buffer.drawingSurface->snapshot();
        RasterSurface readback;
        if (! onGpu && buffer.drawingSurface)
        {
            flushCanvas(buffer);
            if (! buffer.gpuImage->read(readback))
                return nullptr;
            copy = true;
        }
        const auto& pixels = readback.width() ? readback : buffer.pixels;
        if (! pixels.width() || ! pixels.height())
            return nullptr;
        const SkPixmap pixmap(
            SkImageInfo::Make(pixels.width(), pixels.height(), kBGRA_8888_SkColorType, kPremul_SkAlphaType),
            pixels.pixels(), static_cast<std::size_t>(pixels.width()) * 4);
        return copy ? SkImages::RasterFromPixmapCopy(pixmap) : SkImages::RasterFromPixmap(pixmap, nullptr, nullptr);
    }

    bool DrawingSurface::resize(int width, int height, const std::shared_ptr<GaneshContext>& context)
    {
        if (gpu && context && gpu->image()->device() == context->device() && gpu->image()->width() == width
            && gpu->image()->height() == height)
            return false;
        const bool changed = gpu != nullptr;
        gpu.reset();
        if (context && width > 0 && height > 0)
            gpu = GaneshSurface::create(context, width, height);
        if (gpu)
        {
            raster = RasterSurface {};
            return true;
        }
        return raster.resize(width, height) || changed;
    }
    Layer DrawingSurface::content(const Region& damage) const
    {
        Layer layer;
        if (gpu)
            layer.content = GpuContent { gpu->image(), ! damage.empty() };
        else
            layer.content = RasterContent { &raster, damage };
        return layer;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
