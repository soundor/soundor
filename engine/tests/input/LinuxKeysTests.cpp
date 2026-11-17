// The X11 input's keys, without an X server: keysyms to the Web's keys.

#include "X11TestSupport.h"
#include "input/linux/Keys.h"

#include <cstdint>
#include <string>

using namespace soundor;
using namespace soundor::input::x11;

TEST_SUITE("native input: X11 keys")
{
    TEST_CASE("named keys get their Web names, the keypad's too")
    {
        CHECK(keyName(XK_Return, nullptr) == "Enter");
        CHECK(keyName(XK_KP_Enter, nullptr) == "Enter");
        CHECK(keyName(XK_ISO_Left_Tab, nullptr) == "Tab");
        CHECK(keyName(XK_BackSpace, nullptr) == "Backspace");
        CHECK(keyName(XK_KP_Delete, nullptr) == "Delete");
        CHECK(keyName(XK_Escape, nullptr) == "Escape");
        CHECK(keyName(XK_KP_Left, nullptr) == "ArrowLeft");
        CHECK(keyName(XK_Page_Down, nullptr) == "PageDown");
        CHECK(keyName(XK_F1, nullptr) == "F1");
        CHECK(keyName(XK_F24, nullptr) == "F24");
        CHECK(keyName(XK_Super_L, nullptr) == "Meta");
        CHECK(keyName(XK_ISO_Level3_Shift, nullptr) == "AltGraph");
        CHECK(keyName(XK_Shift_R, nullptr) == "Shift");
        CHECK(keyName(XF86XK_AudioPlay, nullptr) == "MediaPlayPause");
        CHECK(keyName(XK_dead_acute, nullptr) == "Dead");
        CHECK(keyName(NoSymbol, nullptr).empty());
    }

    TEST_CASE("character keys are their character, in any script")
    {
        CHECK(keyName(XK_a, nullptr) == "a");
        CHECK(keyName(XK_A, nullptr) == "A");
        CHECK(keyName(XK_space, nullptr) == " ");
        CHECK(keyName(XK_KP_7, nullptr) == "7");
        CHECK(keyName(XK_KP_Decimal, nullptr) == ".");
        CHECK(keyName(XK_odiaeresis, nullptr) == "ö");
        CHECK(keyName(0x1000439, nullptr) == "й"); // a Unicode keysym
        CHECK(keyName(0x10020AC, nullptr) == "€");
        // A legacy keysym is a character through the converter it is given.
        CHECK(keyName(XK_Cyrillic_shorti, [](std::uint32_t) { return std::string("й"); }) == "й");
        CHECK(keyName(XK_Cyrillic_shorti, nullptr).empty());
    }

    TEST_CASE("modifiers: Shift, Control, Alt (Mod1) and Meta (Mod4, Super)")
    {
        CHECK(modifiersOf(0) == 0);
        CHECK(modifiersOf(ShiftMask | LockMask | Mod2Mask) == ui::Modifier::Shift);
        CHECK(modifiersOf(ControlMask | Mod1Mask) == (ui::Modifier::Control | ui::Modifier::Alt));
        CHECK(modifiersOf(Mod4Mask) == ui::Modifier::Meta);
        // AltGr (Mod5) is no modifier of the Web's: it chooses characters.
        CHECK(modifiersOf(Mod5Mask | (1U << 13)) == 0);
        CHECK(modifierOfKey("Shift") == ui::Modifier::Shift);
        CHECK(modifierOfKey("Meta") == ui::Modifier::Meta);
        CHECK(modifierOfKey("a") == 0);
    }

    TEST_CASE("only plain and AltGr characters type text, and never control characters")
    {
        CHECK(typedText("a", 0) == "a");
        CHECK(typedText("A", ui::Modifier::Shift) == "A");
        CHECK(typedText("a", ui::Modifier::Control).empty());
        CHECK(typedText("@", ui::Modifier::Control | ui::Modifier::Alt) == "@");
        CHECK(typedText("\x08", 0).empty());
        CHECK(typedText("\x7f", 0).empty());
        CHECK(typedText("\x1b", 0).empty());
        CHECK(typedText("é", 0) == "é");
        CHECK(typedText("日本", 0) == "日本");
    }
}
