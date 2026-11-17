#include "input/ClickCounter.h"

#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    namespace
    {
        bool nearby(ui::Point a, ui::Point b) noexcept
        {
            return std::abs(a.x - b.x) <= ClickCounter::slop && std::abs(a.y - b.y) <= ClickCounter::slop;
        }
    } // namespace

    ClickCounter::ClickCounter(std::chrono::milliseconds doubleClickTime) noexcept
        : interval(static_cast<std::uint32_t>(doubleClickTime.count() > 0 ? doubleClickTime.count() : 0))
    {
    }

    int ClickCounter::press(int button, ui::Point position, std::uint32_t time) noexcept
    {
        // Unsigned: a clock that wrapped between the two still subtracts.
        const bool continues = last && last->button == button && ! last->dragged
                               && static_cast<std::uint32_t>(time - last->time) <= interval
                               && nearby(last->position, position);
        const int count = continues ? last->count + 1 : 1;
        last = Press { .button = button, .position = position, .time = time, .count = count, .dragged = false };
        return count;
    }

    void ClickCounter::move(ui::Point position) noexcept
    {
        if (last && ! last->dragged && ! nearby(last->position, position))
            last->dragged = true;
    }

    void ClickCounter::reset() noexcept
    {
        last.reset();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
