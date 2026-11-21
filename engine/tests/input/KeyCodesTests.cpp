#include "input/KeyCodes.h"
#include "input/windows/Translation.h"

#include <doctest/doctest.h>

using namespace soundor::input;

TEST_SUITE("native input: key codes")
{
    TEST_CASE("each platform's physical keys are named as the Web names them")
    {
        // Linux: evdev codes (X11 keycodes less 8).
        CHECK(codeOfEvdev(31) == "KeyS");
        CHECK(codeOfEvdev(2) == "Digit1");
        CHECK(codeOfEvdev(42) == "ShiftLeft");
        CHECK(codeOfEvdev(96) == "NumpadEnter");
        CHECK(codeOfEvdev(125) == "MetaLeft");
        CHECK(codeOfEvdev(0).empty());
        CHECK(codeOfEvdev(0xFFFF).empty());
        // Windows: set 1 scan codes, 0xE0xx extended.
        CHECK(codeOfScancode(0x1F) == "KeyS");
        CHECK(codeOfScancode(0x1C) == "Enter");
        CHECK(codeOfScancode(0xE01C) == "NumpadEnter");
        CHECK(codeOfScancode(0x1D) == "ControlLeft");
        CHECK(codeOfScancode(0xE01D) == "ControlRight");
        CHECK(codeOfScancode(0x45) == "Pause");
        CHECK(codeOfScancode(0xE045) == "NumLock");
        CHECK(codeOfScancode(0).empty());
        // macOS: virtual key codes (kVK_ANSI_A is 0).
        CHECK(codeOfMacKeyCode(0x00) == "KeyA");
        CHECK(codeOfMacKeyCode(0x01) == "KeyS");
        CHECK(codeOfMacKeyCode(0x12) == "Digit1");
        CHECK(codeOfMacKeyCode(0x37) == "MetaLeft");
        CHECK(codeOfMacKeyCode(0x3A) == "AltLeft");
        CHECK(codeOfMacKeyCode(0x3F) == "Fn");
        CHECK(codeOfMacKeyCode(0xFFFF).empty());
    }

    TEST_CASE("a Windows key's code comes from its scan code, else its virtual key")
    {
        using soundor::input::win32::codeOf;
        using soundor::input::win32::physicalKey;
        // lParam: the scan code in bits 16 to 23, extended in bit 24.
        CHECK(codeOf(physicalKey(0x53, 0x1FU << 16)) == "KeyS");
        CHECK(codeOf(physicalKey(0x0D, 0x1CU << 16)) == "Enter");
        CHECK(codeOf(physicalKey(0x0D, (0x1CU << 16) | (1U << 24))) == "NumpadEnter");
        // Synthetic messages without one.
        CHECK(codeOf(physicalKey('S', 0)) == "KeyS");
        CHECK(codeOf(physicalKey('7', 0)) == "Digit7");
        CHECK(codeOf(physicalKey(0x25, 0)) == "ArrowLeft"); // VK_LEFT
    }

    TEST_CASE("input without a physical key gets the US layout's")
    {
        CHECK(codeOfKey("s") == "KeyS");
        CHECK(codeOfKey("S") == "KeyS");
        CHECK(codeOfKey("1") == "Digit1");
        CHECK(codeOfKey("!") == "Digit1");
        CHECK(codeOfKey(")") == "Digit0");
        CHECK(codeOfKey("?") == "Slash");
        CHECK(codeOfKey("\"") == "Quote");
        CHECK(codeOfKey(" ") == "Space");
        CHECK(codeOfKey("Shift") == "ShiftLeft");
        CHECK(codeOfKey("Control") == "ControlLeft");
        CHECK(codeOfKey("Alt") == "AltLeft");
        CHECK(codeOfKey("Meta") == "MetaLeft");
        CHECK(codeOfKey("AltGraph") == "AltRight");
        CHECK(codeOfKey("Enter") == "Enter");
        CHECK(codeOfKey("ArrowLeft") == "ArrowLeft");
        CHECK(codeOfKey("F5") == "F5");
        CHECK(codeOfKey("\xC3\x9F").empty()); // ß
        CHECK(codeOfKey("Dead").empty());
        CHECK(codeOfKey("").empty());
    }
}
