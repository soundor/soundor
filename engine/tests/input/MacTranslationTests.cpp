#include "input/apple/Translation.h"

#include <doctest/doctest.h>

using namespace soundor;
using namespace soundor::input::apple;

TEST_SUITE("native input: macOS translation")
{
    TEST_CASE("precise scrolling preserves both fractional axes and direction")
    {
        const auto wheel = wheelInput(0.125, -1.375, true, 1, { 3, 4 }, ui::Modifier::Alt);
        CHECK(wheel.deltaX == doctest::Approx(-0.125));
        CHECK(wheel.deltaY == doctest::Approx(1.375));
        CHECK(wheel.unit == ui::WheelInput::Unit::Pixel);
        CHECK(wheel.position.x == 3);
        CHECK(wheel.modifiers == ui::Modifier::Alt);
        const auto scaled = wheelInput(0.125, -1.375, true, 2, {}, 0);
        CHECK(scaled.deltaX == doctest::Approx(wheel.deltaX / 2));
        CHECK(scaled.deltaY == doctest::Approx(wheel.deltaY / 2));
    }

    TEST_CASE("a stepped wheel remains lines, including fractional high resolution wheels")
    {
        const auto wheel = wheelInput(-1, 0.25, false, 2, {}, 0);
        CHECK(wheel.unit == ui::WheelInput::Unit::Line);
        CHECK(wheel.deltaX == 3);
        CHECK(wheel.deltaY == doctest::Approx(-0.75));
    }

    TEST_CASE("AppKit modifier bits and mouse buttons have Web meanings")
    {
        CHECK(modifiersOf(1ULL << 17) == ui::Modifier::Shift);
        CHECK(modifiersOf(1ULL << 18) == ui::Modifier::Control);
        CHECK(modifiersOf(1ULL << 19) == ui::Modifier::Alt);
        CHECK(modifiersOf(1ULL << 20) == ui::Modifier::Meta);
        CHECK(modifiersOf(0x1e0000)
              == (ui::Modifier::Shift | ui::Modifier::Control | ui::Modifier::Alt | ui::Modifier::Meta));
        CHECK(modifiersOf((1ULL << 16) | (1ULL << 23)) == 0);
        CHECK(buttonOf(0) == 0);
        CHECK(buttonOf(1) == 2);
        CHECK(buttonOf(2) == 1);
        CHECK(buttonMask(0) == 1);
        CHECK(buttonMask(1) == 2);
        CHECK(buttonMask(2) == 4);
        CHECK(buttonOf(3) == -1);
        CHECK(buttonMask(3) == 0);
    }

    TEST_CASE("layout characters name keys; key codes only name special keys")
    {
        CHECK(keyName(0, "a", "a") == "a");
        CHECK(keyName(0, "A", "A") == "A");
        CHECK(keyName(0, "й", "й") == "й");
        CHECK(keyName(0, "å", "a") == "å");
        CHECK(keyName(0, "\x01", "a") == "a");
        CHECK(keyName(36, "\r", "\r") == "Enter");
        CHECK(keyName(51, "", "") == "Backspace");
        CHECK(keyName(56, "", "") == "Shift");
        CHECK(keyName(123, "", "") == "ArrowLeft");
        CHECK(keyName(122, "", "") == "F1");
        CHECK(keyName(0, "", "") == "Dead");
    }
}
