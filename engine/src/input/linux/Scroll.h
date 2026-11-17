#pragma once

#include <soundor/Config.h>
#include <soundor/ui/Input.h>

#include <optional>
#include <span>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
{
    // Scrolling, in notches: what one click of a stepped wheel scrolls. A
    // touchpad, or a high-resolution wheel, scrolls fractions of one.
    // Positive y scrolls down, positive x right, as WheelInput's deltas.
    struct Scroll
    {
        double x = 0;
        double y = 0;

        [[nodiscard]] bool empty() const noexcept { return x == 0 && y == 0; }
        Scroll& operator+=(const Scroll& other) noexcept
        {
            x += other.x;
            y += other.y;
            return *this;
        }
    };

    // An XInput 2.1 scroll axis of a device (XIScrollClassInfo): the valuator
    // that carries it, and how much of it a notch is (its increment; negative
    // where the device scrolls the other way).
    struct ScrollAxis
    {
        int valuator = 0;
        bool horizontal = false;
        double increment = 1;
        // The valuator's value as last seen (XIValuatorClassInfo::value):
        // the next is compared with it. Unknown until seen.
        std::optional<double> value;
    };

    // The scroll axes of each device scrolling reaches the view through.
    //
    // XInput 2 reports a scroll axis as a valuator whose value adds up what
    // was scrolled, so scrolling is the difference from the value before,
    // over the axis's increment. Each slave device has its own values (a
    // master's events carry its current slave's: their sourceid). What
    // moved while the pointer was elsewhere went to other windows: the
    // values are taken again from the device (redefine()) when it comes
    // back, and on any change to the device, rather than counted as ours.
    class ScrollDevices
    {
    public:
        // `device`'s scroll axes, with their current values; none forgets it.
        void define(int device, std::vector<ScrollAxis> axes);
        void forget(int device);
        void clear() noexcept { devices.clear(); }
        [[nodiscard]] bool scrolls(int device) const noexcept;

        // A motion event from `device`: its valuator mask (XIValuatorState's,
        // a bit per valuator) and the values of the valuators it sets, in
        // order. What its scroll axes moved since their last values; zero
        // the first time an axis is seen, which only gives it its value.
        [[nodiscard]] Scroll motion(int device, std::span<const unsigned char> mask, std::span<const double> values);

    private:
        struct Device
        {
            int id = 0;
            std::vector<ScrollAxis> axes;
        };
        std::vector<Device> devices;
    };

    // A core wheel button (4 up, 5 down, 6 left, 7 right) as a notch.
    [[nodiscard]] std::optional<Scroll> wheelButton(int button) noexcept;

    // Notches as wheel input: whole ones as lines (linesPerNotch each), as a
    // stepped wheel's are; any fraction (a touchpad, a high-resolution
    // wheel) as pixels, the same distance per notch, so that one device
    // scrolls the same however its scrolling is split up.
    [[nodiscard]] ui::WheelInput wheelInput(Scroll notches, ui::Point position, ui::Modifiers modifiers) noexcept;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
