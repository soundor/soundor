#include "input/linux/Keys.h"

#include <X11/X.h>
#include <X11/XF86keysym.h>
#include <X11/keysym.h>

#include <algorithm>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
{
    namespace
    {
        void appendUtf8(std::string& out, char32_t code)
        {
            if (code < 0x80)
                out.push_back(static_cast<char>(code));
            else if (code < 0x800)
            {
                out.push_back(static_cast<char>(0xC0 | (code >> 6)));
                out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
            }
            else if (code < 0x10000)
            {
                out.push_back(static_cast<char>(0xE0 | (code >> 12)));
                out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
                out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
            }
            else
            {
                out.push_back(static_cast<char>(0xF0 | (code >> 18)));
                out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
                out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
                out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
            }
        }

        // Keys that type no character, by the Web's names.
        constexpr std::pair<std::uint32_t, const char*> named[] = {
            { XK_Return, "Enter" },
            { XK_KP_Enter, "Enter" },
            { XK_Escape, "Escape" },
            { XK_Tab, "Tab" },
            { XK_ISO_Left_Tab, "Tab" }, // Shift+Tab
            { XK_KP_Tab, "Tab" },
            { XK_BackSpace, "Backspace" },
            { XK_Delete, "Delete" },
            { XK_KP_Delete, "Delete" },
            { XK_Insert, "Insert" },
            { XK_KP_Insert, "Insert" },
            { XK_Home, "Home" },
            { XK_KP_Home, "Home" },
            { XK_End, "End" },
            { XK_KP_End, "End" },
            { XK_Page_Up, "PageUp" },
            { XK_KP_Page_Up, "PageUp" },
            { XK_Page_Down, "PageDown" },
            { XK_KP_Page_Down, "PageDown" },
            { XK_Left, "ArrowLeft" },
            { XK_KP_Left, "ArrowLeft" },
            { XK_Right, "ArrowRight" },
            { XK_KP_Right, "ArrowRight" },
            { XK_Up, "ArrowUp" },
            { XK_KP_Up, "ArrowUp" },
            { XK_Down, "ArrowDown" },
            { XK_KP_Down, "ArrowDown" },
            { XK_KP_Begin, "Clear" },
            { XK_Clear, "Clear" },
            { XK_Shift_L, "Shift" },
            { XK_Shift_R, "Shift" },
            { XK_Control_L, "Control" },
            { XK_Control_R, "Control" },
            { XK_Alt_L, "Alt" },
            { XK_Alt_R, "Alt" },
            { XK_Meta_L, "Meta" },
            { XK_Meta_R, "Meta" },
            { XK_Super_L, "Meta" },
            { XK_Super_R, "Meta" },
            { XK_Hyper_L, "Hyper" },
            { XK_Hyper_R, "Hyper" },
            { XK_ISO_Level3_Shift, "AltGraph" },
            { XK_Mode_switch, "AltGraph" },
            { XK_Caps_Lock, "CapsLock" },
            { XK_Shift_Lock, "CapsLock" },
            { XK_Num_Lock, "NumLock" },
            { XK_Scroll_Lock, "ScrollLock" },
            { XK_Menu, "ContextMenu" },
            { XK_Print, "PrintScreen" },
            { XK_Pause, "Pause" },
            { XK_Break, "Pause" },
            { XK_Help, "Help" },
            { XK_Multi_key, "Compose" },
            { XK_Undo, "Undo" },
            { XK_Redo, "Redo" },
            { XK_Find, "Find" },
            { XK_Cancel, "Cancel" },
            { XK_Execute, "Execute" },
            { XK_Select, "Select" },
            { XF86XK_AudioPlay, "MediaPlayPause" },
            { XF86XK_AudioPause, "MediaPlayPause" },
            { XF86XK_AudioStop, "MediaStop" },
            { XF86XK_AudioNext, "MediaTrackNext" },
            { XF86XK_AudioPrev, "MediaTrackPrevious" },
            { XF86XK_AudioForward, "MediaFastForward" },
            { XF86XK_AudioRewind, "MediaRewind" },
            { XF86XK_AudioRecord, "MediaRecord" },
            { XF86XK_AudioMute, "AudioVolumeMute" },
            { XF86XK_AudioRaiseVolume, "AudioVolumeUp" },
            { XF86XK_AudioLowerVolume, "AudioVolumeDown" },
        };

        bool isControl(char32_t code) noexcept
        {
            return code < 0x20 || code == 0x7F || (code >= 0x80 && code < 0xA0);
        }

        // The first code point of UTF-8 text (no validation beyond its length).
        char32_t firstCodePoint(const std::string& text) noexcept
        {
            if (text.empty())
                return 0;
            const auto lead = static_cast<unsigned char>(text[0]);
            if (lead < 0x80)
                return lead;
            if (lead >= 0xC0 && lead < 0xE0 && text.size() >= 2)
                return ((lead & 0x1FU) << 6) | (static_cast<unsigned char>(text[1]) & 0x3FU);
            if (lead >= 0xE0 && lead < 0xF0 && text.size() >= 3)
                return ((lead & 0x0FU) << 12) | ((static_cast<unsigned char>(text[1]) & 0x3FU) << 6)
                       | (static_cast<unsigned char>(text[2]) & 0x3FU);
            if (lead >= 0xF0 && text.size() >= 4)
                return ((lead & 0x07U) << 18) | ((static_cast<unsigned char>(text[1]) & 0x3FU) << 12)
                       | ((static_cast<unsigned char>(text[2]) & 0x3FU) << 6)
                       | (static_cast<unsigned char>(text[3]) & 0x3FU);
            return 0xFFFD;
        }
    } // namespace

    std::string basicKeysymText(std::uint32_t keysym)
    {
        char32_t code = 0;
        if ((keysym >= 0x20 && keysym <= 0x7E) || (keysym >= 0xA0 && keysym <= 0xFF))
            code = keysym; // Latin-1 keysyms are their code points
        else if (keysym >= 0x01000100 && keysym <= 0x0110FFFF)
            code = keysym - 0x01000000; // Unicode keysyms
        else if (keysym >= XK_KP_0 && keysym <= XK_KP_9)
            code = U'0' + (keysym - XK_KP_0);
        else
        {
            switch (keysym)
            {
                case XK_KP_Space:
                    code = U' ';
                    break;
                case XK_KP_Multiply:
                    code = U'*';
                    break;
                case XK_KP_Add:
                    code = U'+';
                    break;
                case XK_KP_Separator:
                    code = U',';
                    break;
                case XK_KP_Subtract:
                    code = U'-';
                    break;
                case XK_KP_Decimal:
                    code = U'.';
                    break;
                case XK_KP_Divide:
                    code = U'/';
                    break;
                case XK_KP_Equal:
                    code = U'=';
                    break;
                default:
                    return {};
            }
        }
        std::string text;
        appendUtf8(text, code);
        return text;
    }

    std::string keyName(std::uint32_t keysym, KeysymText text)
    {
        if (keysym == NoSymbol)
            return {};
        for (const auto& [sym, name] : named)
            if (sym == keysym)
                return name;
        if (keysym >= XK_F1 && keysym <= XK_F35)
            return "F" + std::to_string(keysym - XK_F1 + 1);
        // A dead key (a combining accent) composes with the next one.
        if (keysym >= XK_dead_grave && keysym <= XK_dead_greek)
            return "Dead";
        std::string character = (text != nullptr ? text : basicKeysymText)(keysym);
        if (character.empty() || isControl(firstCodePoint(character)))
            return {};
        return character;
    }

    ui::Modifiers modifiersOf(unsigned state) noexcept
    {
        ui::Modifiers modifiers = 0;
        if ((state & ShiftMask) != 0)
            modifiers |= ui::Modifier::Shift;
        if ((state & ControlMask) != 0)
            modifiers |= ui::Modifier::Control;
        if ((state & Mod1Mask) != 0)
            modifiers |= ui::Modifier::Alt;
        if ((state & Mod4Mask) != 0)
            modifiers |= ui::Modifier::Meta;
        return modifiers;
    }

    ui::Modifiers modifierOfKey(const std::string& key) noexcept
    {
        if (key == "Shift")
            return ui::Modifier::Shift;
        if (key == "Control")
            return ui::Modifier::Control;
        if (key == "Alt")
            return ui::Modifier::Alt;
        if (key == "Meta")
            return ui::Modifier::Meta;
        return 0;
    }

    std::string typedText(std::string text, ui::Modifiers modifiers)
    {
        // Shortcuts type nothing; AltGr (ISO_Level3, not Control) still types.
        if ((modifiers & ui::Modifier::Control) != 0 && (modifiers & ui::Modifier::Alt) == 0)
            return {};
        std::string typed;
        for (std::size_t i = 0; i < text.size();)
        {
            const auto lead = static_cast<unsigned char>(text[i]);
            const std::size_t length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
            const std::string one = text.substr(i, length);
            if (! isControl(firstCodePoint(one)))
                typed += one;
            i += length;
        }
        return typed;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
