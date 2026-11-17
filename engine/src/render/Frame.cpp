#include <soundor/render/Frame.h>
#include <soundor/render/Region.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <limits>

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

    std::array<float, 2> Transform::map(float x, float y) const noexcept
    {
        return { a * x + c * y + e, b * x + d * y + f };
    }

    Transform operator*(const Transform& x, const Transform& y) noexcept
    {
        return { x.a * y.a + x.c * y.b, x.b * y.a + x.d * y.b,       x.a * y.c + x.c * y.d,
                 x.b * y.c + x.d * y.d, x.a * y.e + x.c * y.f + x.e, x.b * y.e + x.d * y.f + x.f };
    }

    std::optional<Transform> Transform::inverse() const noexcept
    {
        const float determinant = a * d - b * c;
        if (! std::isfinite(determinant) || std::abs(determinant) < 1e-12f)
            return std::nullopt;
        return Transform { d / determinant,
                           -b / determinant,
                           -c / determinant,
                           a / determinant,
                           (c * f - d * e) / determinant,
                           (b * e - a * f) / determinant };
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
        if (! std::isfinite(a) || ! std::isfinite(b) || ! std::isfinite(c) || ! std::isfinite(d) || ! std::isfinite(e)
            || ! std::isfinite(f))
            return {};
        constexpr double infinity = std::numeric_limits<double>::infinity();
        double left = infinity, top = infinity, right = -infinity, bottom = -infinity;
        for (const float x : xs)
            for (const float y : ys)
            {
                const double mappedX = static_cast<double>(a) * x + static_cast<double>(c) * y + e;
                const double mappedY = static_cast<double>(b) * x + static_cast<double>(d) * y + f;
                left = std::min(left, mappedX);
                top = std::min(top, mappedY);
                right = std::max(right, mappedX);
                bottom = std::max(bottom, mappedY);
            }
        constexpr double limit = 536870911;
        const auto l = static_cast<int>(std::clamp(std::floor(left), -limit, limit));
        const auto t = static_cast<int>(std::clamp(std::floor(top), -limit, limit));
        return { l, t, static_cast<int>(std::clamp(std::ceil(right), -limit, limit)) - l,
                 static_cast<int>(std::clamp(std::ceil(bottom), -limit, limit)) - t };
    }

    LayerId newLayerId() noexcept
    {
        static std::atomic<LayerId> next { 1 };
        return next.fetch_add(1, std::memory_order_relaxed);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
