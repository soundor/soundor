#include <soundor/render/Frame.h>
#include <soundor/render/Region.h>

#include <atomic>
#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    void Region::add(const IntRect& rect)
    {
        if (rect.empty())
            return;
        IntRect merged = rect;
        // Overlapping rectangles become one; that may overlap others again.
        for (bool grew = true; grew;)
        {
            grew = false;
            for (auto at = list.begin(); at != list.end(); ++at)
            {
                if (at->contains(merged))
                    return;
                if (at->intersects(merged))
                {
                    merged = merged.united(*at);
                    list.erase(at);
                    grew = true;
                    break;
                }
            }
        }
        list.push_back(merged);
        if (list.size() > maxRects)
        {
            const IntRect all = bounds();
            list.assign(1, all);
        }
    }

    void Region::clip(const IntRect& rect)
    {
        std::vector<IntRect> clipped;
        for (const IntRect& at : list)
            if (const IntRect inside = at.intersected(rect); ! inside.empty())
                clipped.push_back(inside);
        list = std::move(clipped);
    }

    IntRect Region::bounds() const noexcept
    {
        IntRect all;
        for (const IntRect& rect : list)
            all = all.united(rect);
        return all;
    }

    long long Region::area() const noexcept
    {
        long long total = 0;
        for (const IntRect& rect : list)
            total += rect.area();
        return total;
    }

    bool Region::intersects(const IntRect& rect) const noexcept
    {
        for (const IntRect& at : list)
            if (at.intersects(rect))
                return true;
        return false;
    }

    bool RasterSurface::resize(int width, int height)
    {
        width = std::max(0, width);
        height = std::max(0, height);
        if (width == pixelWidth && height == pixelHeight)
            return false;
        pixelWidth = width;
        pixelHeight = height;
        storage.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0);
        return true;
    }

    Bitmap RasterSurface::bitmap() noexcept
    {
        return { storage.data(), pixelWidth, pixelHeight, static_cast<std::size_t>(pixelWidth) * 4 };
    }

    bool Transform::isIdentity() const noexcept
    {
        return *this == Transform {};
    }

    bool Clip::rounded() const noexcept
    {
        return radii != std::array<float, 4> {};
    }

    bool Layer::samePlacement(const Layer& other) const noexcept
    {
        return id == other.id && bounds == other.bounds && transform == other.transform && opacity == other.opacity
               && clip == other.clip;
    }

    bool Transform::isIntegerTranslate() const noexcept
    {
        return a == 1 && b == 0 && c == 0 && d == 1 && std::nearbyint(e) == e && std::nearbyint(f) == f;
    }

    IntRect Transform::mapBounds(const IntRect& rect) const noexcept
    {
        if (rect.empty())
            return {};
        const float xs[2] = { static_cast<float>(rect.x), static_cast<float>(rect.right()) };
        const float ys[2] = { static_cast<float>(rect.y), static_cast<float>(rect.bottom()) };
        float left = INFINITY;
        float top = INFINITY;
        float right = -INFINITY;
        float bottom = -INFINITY;
        for (const float x : xs)
            for (const float y : ys)
            {
                const float mappedX = a * x + c * y + e;
                const float mappedY = b * x + d * y + f;
                left = std::min(left, mappedX);
                top = std::min(top, mappedY);
                right = std::max(right, mappedX);
                bottom = std::max(bottom, mappedY);
            }
        const auto l = static_cast<int>(std::floor(left));
        const auto t = static_cast<int>(std::floor(top));
        return { l, t, static_cast<int>(std::ceil(right)) - l, static_cast<int>(std::ceil(bottom)) - t };
    }

    LayerId newLayerId() noexcept
    {
        static std::atomic<LayerId> next { 1 };
        return next.fetch_add(1, std::memory_order_relaxed);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
