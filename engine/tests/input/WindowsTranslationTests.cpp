#include "input/windows/Translation.h"

#include <doctest/doctest.h>

using namespace soundor;
using namespace soundor::input::win32;

TEST_SUITE("native input: Win32 normalization")
{
    TEST_CASE("wheel fractions retain both axes, direction and repeated sub-notch movement")
    {
        auto vertical = wheelInput(1, false, { 12, 34 }, ui::Modifier::Control);
        CHECK(vertical.unit == ui::WheelInput::Unit::Line);
        CHECK(vertical.deltaY == doctest::Approx(-0.025));
        CHECK(vertical.deltaX == 0);
        CHECK(vertical.position.x == 12);
        CHECK(vertical.modifiers == ui::Modifier::Control);
        const auto horizontal = wheelInput(30, true, {}, 0);
        CHECK(horizontal.deltaX == doctest::Approx(0.75));
        CHECK(horizontal.deltaY == 0);
        CHECK(wheelInput(-120, false, {}, 0).deltaY == 3);
        CHECK(wheelInput(-120, true, {}, 0).deltaX == -3);
        float total = 0;
        for (int i = 0; i < 120; ++i)
            total += wheelInput(1, true, {}, 0).deltaX;
        CHECK(total == doctest::Approx(3));
    }

    TEST_CASE("client units and host scaling are converted once, including negative dragging coordinates")
    {
        const input::ViewGeometry geometry { .x = 20, .y = 30, .scale = 2, .width = 100, .height = 80 };
        const auto inside = clientPosition({ 40, 70 }, geometry);
        CHECK(inside.x == 10);
        CHECK(inside.y == 20);
        const auto outside = clientPosition({ -10, 10 }, geometry);
        CHECK(outside.x == -15);
        CHECK(outside.y == -10);
        CHECK(clientPosition({ 5, 8 }, {}).y == 8);
    }

    TEST_CASE("physical pairing uses scan code and extended identity, rather than layout-dependent VK")
    {
        CHECK(physicalKey('A', 0x001E0000) == physicalKey('Q', 0x001E0000));
        CHECK(physicalKey(0x11, 0x001D0000) != physicalKey(0x11, 0x011D0000));
        CHECK(physicalKey(0x0D, 0x001C0000) != physicalKey(0x0D, 0x011C0000));
        CHECK(physicalKey(0x10, 0x002A0000) != physicalKey(0x10, 0x00360000));
        CHECK(physicalKey('A', 0) != physicalKey('B', 0));
        CHECK(namedKey(0x10) == "Shift");
        CHECK(namedKey(0xA1) == "Shift");
        CHECK(namedKey(0xA5) == "Alt");
        CHECK(namedKey(0x5B) == "Meta");
        CHECK(namedKey(0x27) == "ArrowRight");
        CHECK(namedKey(0x87) == "F24");
        CHECK(namedKey(0xE5) == "Process");
        CHECK(namedKey('A').empty()); // characters come from the active layout
    }

    TEST_CASE("UTF-16 messages preserve Unicode pairs and discard pending pairs on cancellation")
    {
        Characters characters;
        CHECK(characters.append(0xD83D).empty());
        CHECK(characters.append(0xDE00) == "😀");
        CHECK(utf8(u"日本語😀") == "日本語😀");
        CHECK(characters.append(0xD83D).empty());
        characters.reset();
        CHECK(characters.append(u'a') == "a");
        CHECK(characters.append(0xD83D).empty());
        CHECK(characters.append(u'b') == "�b");
        CHECK(characters.append(0xDE00) == "�");
        CHECK(characters.append(u'\r').empty());
        CHECK(utf8(u"\t\na\x7F") == "\t\na\x7F"); // committed text is preserved
    }
}
