#pragma once

#include <soundor/Config.h>

#include <algorithm>
#include <cstddef>
#include <span>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // A rectangle of whole device pixels.
    struct IntRect
    {
        int x = 0;
        int y = 0;
        int width = 0;
        int height = 0;

        [[nodiscard]] constexpr bool empty() const noexcept { return width <= 0 || height <= 0; }
        [[nodiscard]] constexpr int right() const noexcept { return x + width; }
        [[nodiscard]] constexpr int bottom() const noexcept { return y + height; }
        [[nodiscard]] constexpr long long area() const noexcept
        {
            return empty() ? 0 : static_cast<long long>(width) * height;
        }

        [[nodiscard]] constexpr IntRect intersected(const IntRect& other) const noexcept
        {
            const int left = std::max(x, other.x);
            const int top = std::max(y, other.y);
            const int r = std::min(right(), other.right());
            const int b = std::min(bottom(), other.bottom());
            return r > left && b > top ? IntRect { left, top, r - left, b - top } : IntRect {};
        }

        [[nodiscard]] constexpr IntRect united(const IntRect& other) const noexcept
        {
            if (empty())
                return other;
            if (other.empty())
                return *this;
            const int left = std::min(x, other.x);
            const int top = std::min(y, other.y);
            return { left, top, std::max(right(), other.right()) - left, std::max(bottom(), other.bottom()) - top };
        }

        [[nodiscard]] constexpr bool intersects(const IntRect& other) const noexcept
        {
            return ! intersected(other).empty();
        }

        [[nodiscard]] constexpr bool contains(const IntRect& other) const noexcept
        {
            return other.x >= x && other.y >= y && other.right() <= right() && other.bottom() <= bottom();
        }

        friend constexpr bool operator==(const IntRect&, const IntRect&) = default;
    };

    // What changed, as a few rectangles of device pixels: what to draw and
    // present again. It is conservative: it may cover more than changed,
    // never less. Rectangles that overlap are merged, and past a handful
    // the region becomes their bounds.
    class Region
    {
    public:
        static constexpr std::size_t maxRects = 8;

        Region() = default;
        explicit Region(const IntRect& rect) { add(rect); }

        void add(const IntRect& rect);
        void add(const Region& other)
        {
            for (const IntRect& rect : other.rects())
                add(rect);
        }
        // Keeps only what is inside `rect`.
        void clip(const IntRect& rect);
        void clear() noexcept { list.clear(); }

        [[nodiscard]] bool empty() const noexcept { return list.empty(); }
        [[nodiscard]] std::span<const IntRect> rects() const noexcept { return list; }
        [[nodiscard]] IntRect bounds() const noexcept;
        // The pixels covered, counting any overlap once per rectangle.
        [[nodiscard]] long long area() const noexcept;
        [[nodiscard]] bool intersects(const IntRect& rect) const noexcept;

    private:
        std::vector<IntRect> list;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
