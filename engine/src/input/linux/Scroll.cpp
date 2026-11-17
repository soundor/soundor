#include "input/linux/Scroll.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
{
    namespace
    {
        bool isSet(std::span<const unsigned char> mask, int bit) noexcept
        {
            const auto byte = static_cast<std::size_t>(bit) / 8;
            return byte < mask.size() && (mask[byte] & (1U << (static_cast<unsigned>(bit) % 8))) != 0;
        }

        bool whole(double notches) noexcept
        {
            return std::abs(notches - std::round(notches)) < 1e-6;
        }
    } // namespace

    void ScrollDevices::define(int device, std::vector<ScrollAxis> axes)
    {
        forget(device);
        if (! axes.empty())
            devices.push_back({ .id = device, .axes = std::move(axes) });
    }

    void ScrollDevices::forget(int device)
    {
        std::erase_if(devices, [device](const Device& known) { return known.id == device; });
    }

    bool ScrollDevices::scrolls(int device) const noexcept
    {
        return std::ranges::any_of(devices, [device](const Device& known) { return known.id == device; });
    }

    Scroll ScrollDevices::motion(int device, std::span<const unsigned char> mask, std::span<const double> values)
    {
        Scroll scrolled;
        const auto found = std::ranges::find_if(devices, [device](const Device& known) { return known.id == device; });
        if (found == devices.end())
            return scrolled;
        // Values are packed: one for each set bit, lowest valuator first.
        std::size_t next = 0;
        const int valuators = static_cast<int>(mask.size() * 8);
        for (int valuator = 0; valuator < valuators && next < values.size(); ++valuator)
        {
            if (! isSet(mask, valuator))
                continue;
            const double value = values[next++];
            for (ScrollAxis& axis : found->axes)
            {
                if (axis.valuator != valuator)
                    continue;
                if (axis.value && axis.increment != 0)
                    (axis.horizontal ? scrolled.x : scrolled.y) += (value - *axis.value) / axis.increment;
                axis.value = value;
            }
        }
        return scrolled;
    }

    std::optional<Scroll> wheelButton(int button) noexcept
    {
        switch (button)
        {
            case 4:
                return Scroll { .x = 0, .y = -1 };
            case 5:
                return Scroll { .x = 0, .y = 1 };
            case 6:
                return Scroll { .x = -1, .y = 0 };
            case 7:
                return Scroll { .x = 1, .y = 0 };
            default:
                return std::nullopt;
        }
    }

    ui::WheelInput wheelInput(Scroll notches, ui::Point position, ui::Modifiers modifiers) noexcept
    {
        ui::WheelInput input;
        input.position = position;
        input.modifiers = modifiers;
        const bool stepped = whole(notches.x) && whole(notches.y);
        input.unit = stepped ? ui::WheelInput::Unit::Line : ui::WheelInput::Unit::Pixel;
        const double perNotch = ui::linesPerNotch * (stepped ? 1.0 : ui::pixelsPerLine);
        input.deltaX = static_cast<float>((stepped ? std::round(notches.x) : notches.x) * perNotch);
        input.deltaY = static_cast<float>((stepped ? std::round(notches.y) : notches.y) * perNotch);
        return input;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
