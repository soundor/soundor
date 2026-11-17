// The X11 input's scrolling, without an X server: scroll valuators to wheel
// input, and that input through a Surface's scroll views.

#include "input/linux/Scroll.h"

#include <soundor/ui/Surface.h>

#include <doctest/doctest.h>

#include <array>
#include <initializer_list>
#include <string>
#include <vector>

using namespace soundor;
using namespace soundor::input::x11;

namespace
{
    // A touchpad as xf86-input-libinput and Xwayland present one: two
    // pointer valuators (0, 1), then horizontal (2) and vertical (3) scroll.
    std::vector<ScrollAxis> touchpad(double increment = 15, double horizontal = 0, double vertical = 0)
    {
        return { { .valuator = 2, .horizontal = true, .increment = increment, .value = horizontal },
                 { .valuator = 3, .horizontal = false, .increment = increment, .value = vertical } };
    }

    // An XIValuatorState mask for these valuators.
    std::array<unsigned char, 1> mask(std::initializer_list<int> valuators)
    {
        std::array<unsigned char, 1> bits {};
        for (const int valuator : valuators)
            bits[0] = static_cast<unsigned char>(bits[0] | (1U << static_cast<unsigned>(valuator)));
        return bits;
    }

    ui::Style sized(float width, float height, bool scrolls = false)
    {
        ui::Style style;
        style.width = ui::Length::points(width);
        style.height = ui::Length::points(height);
        style.flexShrink = 0;
        if (scrolls)
            style.overflowX = style.overflowY = ui::Overflow::Scroll;
        return style;
    }
} // namespace

TEST_SUITE("native input: X11 scrolling")
{
    TEST_CASE("valuators add up what was scrolled: a motion scrolls its difference, over the increment")
    {
        ScrollDevices devices;
        devices.define(11, touchpad(15, 100, 200));
        CHECK(devices.scrolls(11));
        const auto bits = mask({ 3 });
        const std::array<double, 1> down { 207.5 };
        Scroll scrolled = devices.motion(11, bits, down);
        CHECK(scrolled.x == 0);
        CHECK(scrolled.y == doctest::Approx(0.5));
        const std::array<double, 1> up { 200 };
        scrolled = devices.motion(11, bits, up);
        CHECK(scrolled.y == doctest::Approx(-0.5));
    }

    TEST_CASE("both axes in one motion, with pointer valuators around them, keep their fractions")
    {
        ScrollDevices devices;
        devices.define(11, touchpad(15, 0, 0));
        const auto bits = mask({ 0, 1, 2, 3 });
        // x, y of the pointer first: values are packed in valuator order.
        const std::array<double, 4> values { 640, 480, -1.5, 4.5 };
        const Scroll scrolled = devices.motion(11, bits, values);
        CHECK(scrolled.x == doctest::Approx(-0.1));
        CHECK(scrolled.y == doctest::Approx(0.3));
    }

    TEST_CASE("an axis seen for the first time only takes its value, and other devices are their own")
    {
        ScrollDevices devices;
        std::vector<ScrollAxis> axes = touchpad();
        for (ScrollAxis& axis : axes)
            axis.value.reset();
        devices.define(11, std::move(axes));
        devices.define(12, touchpad(1, 0, 0));
        const auto bits = mask({ 3 });
        const std::array<double, 1> first { 9000 };
        CHECK(devices.motion(11, bits, first).empty());
        const std::array<double, 1> next { 9015 };
        CHECK(devices.motion(11, bits, next).y == doctest::Approx(1));
        // Device 12 has its own values; an unknown device scrolls nothing.
        const std::array<double, 1> other { 2 };
        CHECK(devices.motion(12, bits, other).y == doctest::Approx(2));
        CHECK(devices.motion(13, bits, other).empty());
    }

    TEST_CASE("a device defined again starts from its new values, and a forgotten one scrolls nothing")
    {
        ScrollDevices devices;
        devices.define(11, touchpad(15, 0, 0));
        const auto bits = mask({ 3 });
        const std::array<double, 1> moved { 3000 };
        // As after the pointer came back: what moved meanwhile was not ours.
        devices.define(11, touchpad(15, 0, 2985));
        CHECK(devices.motion(11, bits, moved).y == doctest::Approx(1));
        devices.forget(11);
        CHECK_FALSE(devices.scrolls(11));
        CHECK(devices.motion(11, bits, moved).empty());
        // No scroll axes: not a scrolling device.
        devices.define(11, {});
        CHECK_FALSE(devices.scrolls(11));
    }

    TEST_CASE("a negative increment scrolls the other way")
    {
        ScrollDevices devices;
        devices.define(5, { { .valuator = 2, .horizontal = false, .increment = -120, .value = 0 } });
        const auto bits = mask({ 2 });
        const std::array<double, 1> values { 120 };
        CHECK(devices.motion(5, bits, values).y == doctest::Approx(-1));
    }

    TEST_CASE("wheel buttons are notches: 4 up, 5 down, 6 left, 7 right")
    {
        CHECK(wheelButton(4).value_or(Scroll {}).y == -1);
        CHECK(wheelButton(5).value_or(Scroll {}).y == 1);
        CHECK(wheelButton(6).value_or(Scroll {}).x == -1);
        CHECK(wheelButton(7).value_or(Scroll {}).x == 1);
        CHECK_FALSE(wheelButton(1));
        CHECK_FALSE(wheelButton(8));
    }

    TEST_CASE("whole notches are a stepped wheel's lines, fractions the same distance in pixels")
    {
        const ui::WheelInput stepped = wheelInput({ .x = 0, .y = 2 }, { 5, 6 }, ui::Modifier::Shift);
        CHECK(stepped.unit == ui::WheelInput::Unit::Line);
        CHECK(stepped.deltaY == doctest::Approx(2 * ui::linesPerNotch));
        CHECK(stepped.deltaX == 0);
        CHECK(stepped.position.x == 5);
        CHECK(stepped.modifiers == ui::Modifier::Shift);
        const ui::WheelInput smooth = wheelInput({ .x = -0.25, .y = 0.1 }, {}, 0);
        CHECK(smooth.unit == ui::WheelInput::Unit::Pixel);
        CHECK(smooth.deltaX == doctest::Approx(-0.25 * ui::linesPerNotch * ui::pixelsPerLine));
        CHECK(smooth.deltaY == doctest::Approx(0.1 * ui::linesPerNotch * ui::pixelsPerLine));
        // A notch is as far whichever way it comes.
        const ui::WheelInput eighths = wheelInput({ .x = 0, .y = 1.0 / 8 }, {}, 0);
        CHECK(eighths.deltaY * 8 == doctest::Approx(ui::linesPerNotch * ui::pixelsPerLine));
    }

    TEST_CASE("fractional scrolling moves nested scroll views by fractions, the inner first, both ways at once")
    {
        ui::Surface surface;
        surface.setSize({ 200, 200 });
        const ui::NodeId outer = surface.createNode(ui::NodeType::View);
        surface.setStyle(outer, sized(200, 200, true));
        surface.insertChild(surface.root().id(), outer);
        const ui::NodeId page = surface.createNode(ui::NodeType::View);
        surface.setStyle(page, sized(200, 800));
        surface.insertChild(outer, page);
        const ui::NodeId inner = surface.createNode(ui::NodeType::View);
        surface.setStyle(inner, sized(100, 100, true));
        surface.insertChild(page, inner);
        const ui::NodeId content = surface.createNode(ui::NodeType::View);
        surface.setStyle(content, sized(300, 150));
        surface.insertChild(inner, content);
        const auto offset = [&](ui::NodeId id) { return surface.find(id)->scrollOffset(); };

        // A touchpad's diagonal: a fraction of a notch on each axis.
        CHECK(surface.wheel(wheelInput({ .x = 0.0125, .y = 0.025 }, { 50, 50 }, 0)));
        CHECK(offset(inner).x == doctest::Approx(1.5));
        CHECK(offset(inner).y == doctest::Approx(3));
        CHECK(offset(outer).y == 0);
        // The inner one at its end: the outer one scrolls on.
        CHECK(surface.wheel(wheelInput({ .x = 0, .y = 1 }, { 50, 50 }, 0)));
        CHECK(offset(inner).y == doctest::Approx(50));
        CHECK(surface.wheel(wheelInput({ .x = 0, .y = 0.5 }, { 50, 50 }, 0)));
        CHECK(offset(outer).y == doctest::Approx(60));
        // Shift turns a vertical wheel horizontal, as browsers do (the
        // inner view is now 60 up, over 0 to 40).
        const float before = offset(inner).x;
        CHECK(surface.wheel(wheelInput({ .x = 0, .y = 1 }, { 50, 20 }, ui::Modifier::Shift)));
        CHECK(offset(inner).x == doctest::Approx(before + ui::linesPerNotch * ui::pixelsPerLine));
    }
}
