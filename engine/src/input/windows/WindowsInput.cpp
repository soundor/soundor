#include "input/windows/WindowsInput.h"

#include "input/ClickCounter.h"
#include "input/windows/Translation.h"

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
#endif
// Win32 headers require Windows declarations before commctrl/IMM.
// clang-format off
#include <windows.h>
#include <commctrl.h>
#include <imm.h>
#include <windowsx.h>
// clang-format on

#include <algorithm>
#include <array>
#include <map>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
{
    namespace
    {
        bool down(int key)
        {
            return (GetKeyState(key) & 0x8000) != 0;
        }

        ui::Modifiers modifiers()
        {
            ui::Modifiers result = 0;
            if (down(VK_SHIFT))
                result |= ui::Modifier::Shift;
            if (down(VK_CONTROL))
                result |= ui::Modifier::Control;
            if (down(VK_MENU))
                result |= ui::Modifier::Alt;
            if (down(VK_LWIN) || down(VK_RWIN))
                result |= ui::Modifier::Meta;
            return result;
        }

        ui::Modifiers pointerModifiers(WPARAM flags)
        {
            auto result = modifiers();
            // Pointer messages carry the state at the event, rather than a
            // later polling state. Alt and Windows keys have no MK_* bits.
            result &= static_cast<ui::Modifiers>(~(ui::Modifier::Shift | ui::Modifier::Control));
            if ((flags & MK_SHIFT) != 0)
                result |= ui::Modifier::Shift;
            if ((flags & MK_CONTROL) != 0)
                result |= ui::Modifier::Control;
            return result;
        }

        std::string keyName(unsigned key, std::uint32_t flags)
        {
            auto name = namedKey(key);
            if (! name.empty())
                return name;
            std::array<BYTE, 256> state {};
            if (! GetKeyboardState(state.data()))
                return "Unidentified";
            // Shortcuts still have a layout-derived character identity. AltGr
            // keeps Ctrl+Alt; other shortcuts do not turn letters into controls.
            if ((state[VK_RMENU] & 0x80U) == 0)
            {
                constexpr std::array<unsigned, 6> shortcutModifiers { VK_CONTROL, VK_LCONTROL, VK_RCONTROL,
                                                                      VK_MENU,    VK_LMENU,    VK_RMENU };
                for (const auto modifier : shortcutModifiers)
                    state[modifier] = 0;
            }
            std::array<WCHAR, 16> text {};
            // Windows 10 1607+: bit 2 explicitly avoids changing the keyboard's
            // dead-key buffer. The host's TranslateMessage owns text translation.
            const int count = ToUnicodeEx(key, (flags >> 16) & 0xFFU, state.data(), text.data(),
                                          static_cast<int>(text.size()), 4, GetKeyboardLayout(0));
            if (count < 0)
                return "Dead";
            std::u16string characters;
            for (int i = 0; i < count && i < static_cast<int>(text.size()); ++i)
                characters += static_cast<char16_t>(text[static_cast<std::size_t>(i)]);
            name = utf8(characters);
            return name.empty() ? "Unidentified" : name;
        }

        // Reference-count just the native callback state: SetFocus, capture,
        // IMM and the next subclass can synchronously destroy an editor. The
        // callback keeps this plain-data queue alive, never a RuntimeHost.
        class Session final : public std::enable_shared_from_this<Session>
        {
        public:
            Session(HWND window, const PlatformOptions& options) : hwnd(window), clicks(options.doubleClickTime) {}
            ~Session()
            {
                detach();
                // An IMM callback can detach the editor from inside an IMM
                // call. Keep its context alive until that call's session
                // reference unwinds, rather than destroy it reentrantly.
                if (context != nullptr)
                    ImmDestroyContext(context);
            }
            Session(const Session&) = delete;
            Session& operator=(const Session&) = delete;

            bool attach()
            {
                context = ImmCreateContext();
                if (context == nullptr)
                    return false;
                if (! SetWindowSubclass(hwnd, windowProc, reinterpret_cast<UINT_PTR>(this),
                                        reinterpret_cast<DWORD_PTR>(this)))
                    return false;
                attached = true;
                previousContext = ImmAssociateContext(hwnd, nullptr);
                if (hwnd == nullptr || ! attached)
                    return false;
                associated = true;
                hasFocus = focused();
                pending.emplace_back(FocusChange { hasFocus });
                return true;
            }

            void detach()
            {
                const HWND window = std::exchange(hwnd, nullptr);
                if (attached && window != nullptr)
                    RemoveWindowSubclass(window, windowProc, reinterpret_cast<UINT_PTR>(this));
                attached = false;
                pending.clear();
                heldKeys.clear();
                held = 0;
                hasFocus = false;
                characters.reset();
                if (window != nullptr)
                {
                    stopTracking(window);
                    if (std::exchange(capturing, false) && GetCapture() == window)
                        ReleaseCapture();
                    if (composing)
                        ImmNotifyIME(context, NI_COMPOSITIONSTR, CPS_CANCEL, 0);
                    if (associated)
                        ImmAssociateContext(window, previousContext);
                }
                associated = false;
                composing = false;
            }

            bool focused() const
            {
                return hwnd != nullptr && ! suspended && active && GetFocus() == hwnd && IsWindowVisible(hwnd);
            }

            void requestFocus()
            {
                if (hwnd != nullptr && ! suspended && IsWindowVisible(hwnd))
                    SetFocus(hwnd);
            }

            void read(std::vector<Event>& events)
            {
                updateFocus();
                if (hwnd != nullptr && ! IsWindowVisible(hwnd))
                    endInput();
                events.insert(events.end(), std::make_move_iterator(pending.begin()),
                              std::make_move_iterator(pending.end()));
                pending.clear();
                typedKey.reset();
            }

            void cancel(std::vector<Event>& events)
            {
                pending.clear();
                endInput();
                read(events);
            }

            void setSuspended(bool next, std::vector<Event>& events)
            {
                if (suspended == next)
                    return;
                suspended = next;
                if (next)
                {
                    cancel(events);
                    if (hwnd != nullptr)
                        stopTracking(hwnd);
                    inside = false;
                }
                syncContext();
                updateFocus();
            }

            void setTextInputFocused(bool next)
            {
                if (textFocused == next)
                    return;
                textFocused = next;
                if (! next)
                    discardComposition();
                syncContext();
            }

            void setGeometry(const ViewGeometry& next)
            {
                geometry = next;
                positionComposition();
            }

            unsigned buttons() const { return held; }

            std::optional<ui::Point> pointerOnScreen() const
            {
                POINT point {};
                if (! GetPhysicalCursorPos(&point))
                    return std::nullopt;
                return ui::Point { static_cast<float>(point.x), static_cast<float>(point.y) };
            }

            static void warpPointer(ui::Point point)
            {
                // Tick callbacks may run in the host's DPI context, rather
                // than the HWND's. Physical APIs keep lock anchors invariant.
                SetPhysicalCursorPos(static_cast<int>(point.x), static_cast<int>(point.y));
            }

        private:
            bool contains(ui::Point client) const
            {
                RECT rect {};
                GetClientRect(hwnd, &rect);
                const float scale = geometry.scale > 0 ? geometry.scale : 1;
                const float right =
                    geometry.width > 0 ? geometry.x + geometry.width * scale : static_cast<float>(rect.right);
                const float bottom =
                    geometry.height > 0 ? geometry.y + geometry.height * scale : static_cast<float>(rect.bottom);
                return client.x >= geometry.x && client.y >= geometry.y && client.x < right && client.y < bottom;
            }

            void stopTracking(HWND window)
            {
                if (std::exchange(tracking, false))
                {
                    TRACKMOUSEEVENT track { sizeof(TRACKMOUSEEVENT), TME_CANCEL | TME_LEAVE, window, 0 };
                    TrackMouseEvent(&track);
                }
            }

            void discardComposition()
            {
                characters.reset();
                typedKey.reset();
                if (std::exchange(composing, false) && context != nullptr)
                    ImmNotifyIME(context, NI_COMPOSITIONSTR, CPS_CANCEL, 0);
            }

            void syncContext()
            {
                if (hwnd != nullptr && associated)
                    ImmAssociateContext(hwnd, suspended ? previousContext : textFocused ? context : nullptr);
                positionComposition();
            }

            void positionComposition()
            {
                if (context == nullptr || hwnd == nullptr || ! textFocused || suspended)
                    return;
                const float scale = geometry.scale > 0 ? geometry.scale : 1;
                const POINT point { static_cast<LONG>(geometry.x),
                                    static_cast<LONG>(geometry.y + geometry.height * scale) };
                // The shared API has no caret rectangle or preedit events.
                // Keep Windows' native composition/candidate UI at the editor.
                COMPOSITIONFORM composition {};
                composition.dwStyle = CFS_POINT;
                composition.ptCurrentPos = point;
                ImmSetCompositionWindow(context, &composition);
                CANDIDATEFORM candidate {};
                candidate.dwStyle = CFS_CANDIDATEPOS;
                candidate.ptCurrentPos = point;
                ImmSetCandidateWindow(context, &candidate);
            }

            void cancelPointer()
            {
                if (std::exchange(held, 0U) != 0)
                    pending.emplace_back(ui::PointerInput {
                        .phase = ui::PointerInput::Phase::Cancel, .position = last, .screen = std::nullopt });
                clicks.reset();
                const HWND window = hwnd;
                if (std::exchange(capturing, false) && window != nullptr && GetCapture() == window)
                    ReleaseCapture();
            }

            void endInput()
            {
                cancelPointer();
                for (const auto& [code, name] : std::exchange(heldKeys, {}))
                {
                    pending.emplace_back(KeyEvent {
                        .key = { .down = false, .key = name, .code = std::string(codeOf(code)) }, .typed = {} });
                }
                discardComposition();
            }

            void updateFocus()
            {
                const bool next = focused();
                if (next == hasFocus)
                    return;
                hasFocus = next;
                if (! next)
                    endInput();
                pending.emplace_back(FocusChange { next });
            }

            std::optional<LRESULT> mouse(UINT message, WPARAM wParam, LPARAM lParam)
            {
                if (suspended)
                    return std::nullopt;
                const ui::Point client { static_cast<float>(GET_X_LPARAM(lParam)),
                                         static_cast<float>(GET_Y_LPARAM(lParam)) };
                const bool within = contains(client);
                if (message == WM_MOUSEMOVE && ! within && inside)
                {
                    inside = false;
                    pending.emplace_back(ui::PointerInput { .phase = ui::PointerInput::Phase::Leave,
                                                            .position = clientPosition(client, geometry),
                                                            .screen = std::nullopt,
                                                            .buttons = held });
                }
                if (! within && held == 0)
                    return std::nullopt;
                inside = within;
                if (! tracking)
                {
                    TRACKMOUSEEVENT track { sizeof(TRACKMOUSEEVENT), TME_LEAVE, hwnd, 0 };
                    tracking = TrackMouseEvent(&track) != FALSE;
                }
                unsigned mask = 0;
                int button = -1;
                bool press = false;
                switch (message)
                {
                    case WM_LBUTTONDOWN:
                    case WM_LBUTTONDBLCLK:
                        press = true;
                        [[fallthrough]];
                    case WM_LBUTTONUP:
                        mask = 1;
                        button = 0;
                        break;
                    case WM_RBUTTONDOWN:
                    case WM_RBUTTONDBLCLK:
                        press = true;
                        [[fallthrough]];
                    case WM_RBUTTONUP:
                        mask = 2;
                        button = 2;
                        break;
                    case WM_MBUTTONDOWN:
                    case WM_MBUTTONDBLCLK:
                        press = true;
                        [[fallthrough]];
                    case WM_MBUTTONUP:
                        mask = 4;
                        button = 1;
                        break;
                    case WM_XBUTTONDOWN:
                    case WM_XBUTTONDBLCLK:
                        press = true;
                        [[fallthrough]];
                    case WM_XBUTTONUP:
                        mask = GET_XBUTTON_WPARAM(wParam) == XBUTTON1 ? 8U : 16U;
                        button = mask == 8 ? 3 : 4;
                        break;
                    default:
                        break;
                }
                const unsigned before = held;
                if (press)
                    held |= mask;
                else if (mask != 0)
                {
                    if ((held & mask) == 0)
                        return 0;
                    held &= ~mask;
                }
                last = clientPosition(client, geometry);
                POINT screen { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
                ClientToScreen(hwnd, &screen);
                const float scale = geometry.scale > 0 ? geometry.scale : 1;
                ui::PointerInput event { .position = last,
                                         .screen = ui::Point { static_cast<float>(screen.x) / scale,
                                                               static_cast<float>(screen.y) / scale },
                                         .button = button,
                                         .buttons = held,
                                         .modifiers = pointerModifiers(wParam),
                                         .pressure = held != 0 ? 0.5F : 0 };
                if (press && before == 0)
                {
                    event.phase = ui::PointerInput::Phase::Down;
                    event.clicks = clicks.press(button, last, static_cast<std::uint32_t>(GetMessageTime()));
                }
                else if (mask != 0 && ! press && held == 0)
                    event.phase = ui::PointerInput::Phase::Up;
                else if (held != 0)
                    clicks.move(last);
                pending.emplace_back(event);
                const HWND window = hwnd;
                if (press && before == 0)
                {
                    capturing = true;
                    SetCapture(window);
                    if (hwnd != nullptr && GetCapture() != window)
                        cancelPointer();
                    requestFocus();
                }
                else if (held == 0 && std::exchange(capturing, false) && GetCapture() == window)
                    ReleaseCapture();
                return message == WM_XBUTTONDOWN || message == WM_XBUTTONUP || message == WM_XBUTTONDBLCLK ? TRUE : 0;
            }

            void key(UINT message, WPARAM wParam, LPARAM lParam)
            {
                const auto flags = static_cast<std::uint32_t>(lParam);
                const unsigned code = physicalKey(static_cast<unsigned>(wParam), flags);
                const bool press = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                const auto known = heldKeys.find(code);
                typedKey.reset();
                if (! press)
                {
                    if (known != heldKeys.end())
                    {
                        pending.emplace_back(KeyEvent { .key = { .down = false,
                                                                 .key = known->second,
                                                                 .code = std::string(codeOf(code)),
                                                                 .modifiers = modifiers() },
                                                        .typed = {} });
                        heldKeys.erase(known);
                    }
                    return;
                }
                std::string name = keyName(static_cast<unsigned>(wParam), flags);
                const bool repeat = known != heldKeys.end() || (flags & (1U << 30)) != 0;
                if (known == heldKeys.end())
                    heldKeys.emplace(code, name);
                pending.emplace_back(KeyEvent { .key = { .down = true,
                                                         .key = std::move(name),
                                                         .code = std::string(codeOf(code)),
                                                         .repeat = repeat,
                                                         .modifiers = modifiers() },
                                                .typed = {} });
                if (! composing)
                    typedKey = TypedKey { pending.size() - 1, code, (flags >> 16) & 0x1FFU, known == heldKeys.end() };
            }

            std::optional<std::string> compositionResult() const
            {
                const LONG bytes = ImmGetCompositionStringW(context, GCS_RESULTSTR, nullptr, 0);
                if (bytes < 0 || bytes % static_cast<LONG>(sizeof(char16_t)) != 0)
                    return std::nullopt;
                if (bytes == 0)
                    return std::string();
                static_assert(sizeof(WCHAR) == sizeof(char16_t));
                std::u16string text(static_cast<std::size_t>(bytes) / sizeof(char16_t), char16_t {});
                const LONG written =
                    ImmGetCompositionStringW(context, GCS_RESULTSTR, text.data(), static_cast<DWORD>(bytes));
                if (written < 0 || written > bytes || written % static_cast<LONG>(sizeof(char16_t)) != 0)
                    return std::nullopt;
                text.resize(static_cast<std::size_t>(written) / sizeof(char16_t));
                return utf8(text);
            }

            void character(WPARAM wParam, LPARAM lParam, bool ime)
            {
                if (! focused() || (ime && ! textFocused))
                    return;
                const auto mods = modifiers();
                if (! ime
                    && ((mods & ui::Modifier::Meta) != 0
                        || ((mods & ui::Modifier::Control) != 0 && (mods & ui::Modifier::Alt) == 0)))
                    return;
                auto text = characters.append(static_cast<char16_t>(wParam), ! ime);
                if (text.empty())
                    return;
                const auto single = text;
                for (unsigned i = 1; i < std::max(1U, static_cast<unsigned>(LOWORD(lParam))); ++i)
                    text += single;
                const unsigned scan = (static_cast<std::uint32_t>(lParam) >> 16) & 0x1FFU;
                if (! ime && ! composing && typedKey && typedKey->event + 1 == pending.size() && typedKey->scan == scan)
                {
                    if (auto* event = std::get_if<KeyEvent>(&pending[typedKey->event]))
                    {
                        const bool first = event->typed.empty();
                        event->typed += text;
                        // WM_CHAR is authoritative for layout/dead-key output,
                        // including VK_PACKET. Keep the release paired with the
                        // initial press's final logical name.
                        if (first)
                            event->key.key = single;
                        else
                            event->key.key += single;
                        if (typedKey->firstPress)
                            heldKeys[typedKey->code] = event->key.key;
                        return;
                    }
                }
                if (textFocused)
                    pending.emplace_back(ui::TextInput { std::move(text) });
            }

            std::optional<LRESULT> process(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
            {
                switch (message)
                {
                    case WM_NCDESTROY:
                        endInput();
                        if (hasFocus)
                            pending.emplace_back(FocusChange { false });
                        // Keep cancellation for the next read; detach invalidates
                        // every native subscription before the HWND can be reused.
                        {
                            auto ended = std::move(pending);
                            detach();
                            pending = std::move(ended);
                        }
                        return std::nullopt;
                    case WM_SETFOCUS:
                        active = true;
                        updateFocus();
                        return std::nullopt;
                    case WM_KILLFOCUS:
                        // During WM_KILLFOCUS, GetFocus can still name this HWND.
                        {
                            const bool notify = std::exchange(hasFocus, false);
                            endInput();
                            if (notify)
                                pending.emplace_back(FocusChange { false });
                        }
                        return std::nullopt;
                    case WM_ACTIVATE:
                        active = LOWORD(wParam) != WA_INACTIVE;
                        if (! active)
                            endInput();
                        updateFocus();
                        return std::nullopt;
                    case WM_SHOWWINDOW:
                        if (wParam == FALSE)
                            endInput();
                        return std::nullopt;
                    case WM_CANCELMODE:
                        endInput();
                        return std::nullopt;
                    case WM_CAPTURECHANGED:
                        if (reinterpret_cast<HWND>(lParam) != window // NOLINT(performance-no-int-to-ptr)
                            && (capturing || held != 0))
                            cancelPointer();
                        return std::nullopt;
                    case WM_MOUSELEAVE:
                        tracking = false;
                        if (! suspended && std::exchange(inside, false))
                            pending.emplace_back(ui::PointerInput { .phase = ui::PointerInput::Phase::Leave,
                                                                    .position = last,
                                                                    .screen = std::nullopt,
                                                                    .buttons = held });
                        return std::nullopt;
                    case WM_MOUSEMOVE:
                        static_cast<void>(mouse(message, wParam, lParam));
                        // The window's own procedure still sees moves (its
                        // cursor); normalized input comes only from our
                        // native queue.
                        return std::nullopt;
                    case WM_LBUTTONDOWN:
                    case WM_LBUTTONUP:
                    case WM_LBUTTONDBLCLK:
                    case WM_RBUTTONDOWN:
                    case WM_RBUTTONUP:
                    case WM_RBUTTONDBLCLK:
                    case WM_MBUTTONDOWN:
                    case WM_MBUTTONUP:
                    case WM_MBUTTONDBLCLK:
                    case WM_XBUTTONDOWN:
                    case WM_XBUTTONUP:
                    case WM_XBUTTONDBLCLK:
                        return mouse(message, wParam, lParam);
                    case WM_MOUSEWHEEL:
                    case WM_MOUSEHWHEEL:
                    {
                        if (suspended)
                            return std::nullopt;
                        POINT point { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
                        ScreenToClient(window, &point);
                        const ui::Point client { static_cast<float>(point.x), static_cast<float>(point.y) };
                        if (! contains(client))
                            return std::nullopt;
                        const int delta = GET_WHEEL_DELTA_WPARAM(wParam);
                        if (delta != 0)
                            pending.emplace_back(wheelInput(delta, message == WM_MOUSEHWHEEL,
                                                            clientPosition(client, geometry),
                                                            pointerModifiers(wParam)));
                        return 0;
                    }
                    case WM_KEYDOWN:
                    case WM_KEYUP:
                    case WM_SYSKEYDOWN:
                    case WM_SYSKEYUP:
                        if (! focused())
                            return std::nullopt;
                        key(message, wParam, lParam);
                        // Collect system keys, but preserve Alt menu/host and
                        // Windows-key behavior. AltGr text stays in our path.
                        if (((message == WM_SYSKEYDOWN || message == WM_SYSKEYUP) && ! (textFocused && down(VK_RMENU)))
                            || wParam == VK_F10 || wParam == VK_LWIN || wParam == VK_RWIN
                            || (modifiers() & ui::Modifier::Meta) != 0)
                            return std::nullopt;
                        return 0;
                    case WM_DEADCHAR:
                    case WM_SYSDEADCHAR:
                        if (message == WM_SYSDEADCHAR && ! (textFocused && down(VK_RMENU)))
                            return std::nullopt;
                        if (! suspended && focused() && typedKey && typedKey->event + 1 == pending.size())
                        {
                            if (auto* event = std::get_if<KeyEvent>(&pending[typedKey->event]))
                            {
                                event->key.key = "Dead";
                                if (typedKey->firstPress)
                                    heldKeys[typedKey->code] = "Dead";
                            }
                            typedKey.reset();
                        }
                        return 0;
                    case WM_CHAR:
                    case WM_SYSCHAR:
                    case WM_IME_CHAR:
                        if (suspended)
                            return std::nullopt;
                        if (message == WM_SYSCHAR && ! (textFocused && down(VK_RMENU)))
                            return std::nullopt;
                        character(wParam, lParam, message == WM_IME_CHAR);
                        return 0;
                    case WM_UNICHAR:
                        if (wParam == UNICODE_NOCHAR)
                            return TRUE;
                        if (! suspended && focused() && textFocused && wParam <= 0x10FFFF)
                        {
                            const auto code = static_cast<char32_t>(wParam);
                            if (code > 0xFFFF)
                            {
                                character(static_cast<WPARAM>(0xD800U + ((code - 0x10000U) >> 10)), 0, true);
                                character(static_cast<WPARAM>(0xDC00U + ((code - 0x10000U) & 0x3FFU)), 0, true);
                            }
                            else
                                character(wParam, 0, true);
                        }
                        return 0;
                    case WM_IME_SETCONTEXT:
                        if (suspended)
                            return std::nullopt;
                        // Deactivation and context activation can precede the
                        // focus message; Windows must still update its IME UI.
                        return DefWindowProcW(window, message, wParam, lParam);
                    case WM_IME_ENDCOMPOSITION:
                        if (suspended)
                            return std::nullopt;
                        composing = false;
                        characters.reset();
                        return DefWindowProcW(window, message, wParam, lParam);
                    case WM_IME_STARTCOMPOSITION:
                    case WM_IME_COMPOSITION:
                        if (suspended)
                            return std::nullopt;
                        if (! textFocused || ! focused())
                            return 0;
                        if (message == WM_IME_STARTCOMPOSITION)
                        {
                            composing = true;
                            typedKey.reset();
                            positionComposition();
                        }
                        if (message == WM_IME_COMPOSITION && (lParam & GCS_RESULTSTR) != 0)
                        {
                            if (const auto result = compositionResult())
                            {
                                characters.reset();
                                typedKey.reset();
                                if (! result->empty())
                                    pending.emplace_back(ui::TextInput { *result });
                                // Do not let DefWindowProc generate duplicate
                                // WM_IME_CHARs for a result already consumed here.
                                // A simultaneous new preedit still needs its UI.
                                constexpr LPARAM resultFlags = GCS_RESULTSTR | GCS_RESULTCLAUSE | GCS_RESULTREADSTR
                                                               | GCS_RESULTREADCLAUSE | CS_INSERTCHAR | CS_NOMOVECARET;
                                const LPARAM remaining = lParam & ~resultFlags;
                                return remaining != 0 ? DefWindowProcW(window, message, wParam, remaining) : 0;
                            }
                        }
                        // Windows manages native preedit UI; IMEs using
                        // WM_IME_CHAR directly remain supported.
                        return DefWindowProcW(window, message, wParam, lParam);
                    default:
                        return std::nullopt;
                }
            }

            static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                                               DWORD_PTR data)
            {
                auto* raw = reinterpret_cast<Session*>(data); // NOLINT(performance-no-int-to-ptr)
                const auto self = raw->shared_from_this();
                try
                {
                    if (const auto result = self->process(window, message, wParam, lParam))
                        return *result;
                }
                catch (...)
                {
                    // No C++ exception may cross a Win32 callback boundary.
                    // Detach on failure; do not leave pointers into editor state.
                    self->detach();
                }
                return DefSubclassProc(window, message, wParam, lParam);
            }

            HWND hwnd;
            ViewGeometry geometry;
            ClickCounter clicks;
            std::vector<Event> pending;
            std::map<unsigned, std::string> heldKeys;
            struct TypedKey
            {
                std::size_t event;
                unsigned code;
                unsigned scan;
                bool firstPress;
            };
            std::optional<TypedKey> typedKey;
            Characters characters;
            ui::Point last;
            HIMC context = nullptr;
            HIMC previousContext = nullptr;
            unsigned held = 0;
            bool attached = false;
            bool associated = false;
            bool capturing = false;
            bool tracking = false;
            bool inside = false;
            bool hasFocus = false;
            bool active = true;
            bool suspended = false;
            bool textFocused = false;
            bool composing = false;
        };

        class WindowsInput final : public PlatformInput
        {
        public:
            explicit WindowsInput(std::shared_ptr<Session> session) : state(std::move(session)) {}
            ~WindowsInput() override { state->detach(); }
            int fileDescriptor() const override { return -1; }
            // Keep the session across reentrant window/IMM calls even if the
            // framework destroys this wrapper during a focus notification.
            void read(std::vector<Event>& events) override
            {
                const auto session = state;
                session->read(events);
            }
            void cancel(std::vector<Event>& events) override
            {
                const auto session = state;
                session->cancel(events);
            }
            void setGeometry(const ViewGeometry& geometry) override
            {
                const auto session = state;
                session->setGeometry(geometry);
            }
            void setSuspended(bool suspended, std::vector<Event>& events) override
            {
                const auto session = state;
                session->setSuspended(suspended, events);
            }
            void setTextInputFocused(bool focused) override
            {
                const auto session = state;
                session->setTextInputFocused(focused);
            }
            void requestFocus() override
            {
                const auto session = state;
                session->requestFocus();
            }
            bool focused() const override { return state->focused(); }
            unsigned buttons() const override { return state->buttons(); }
            std::optional<ui::Point> pointerOnScreen() const override { return state->pointerOnScreen(); }
            void warpPointer(ui::Point point) override { Session::warpPointer(point); }

        private:
            std::shared_ptr<Session> state;
        };
    } // namespace

    std::unique_ptr<PlatformInput> createInput(const PlatformOptions& options, std::string* failure)
    {
        const auto window = static_cast<HWND>(options.view.handle);
        if (window == nullptr || ! IsWindow(window) || ! IsWindowUnicode(window)
            || GetWindowThreadProcessId(window, nullptr) != GetCurrentThreadId())
        {
            if (failure != nullptr)
                *failure = "Windows input needs a Unicode HWND on its owning UI thread";
            return nullptr;
        }
        auto state = std::make_shared<Session>(window, options);
        if (! state->attach())
        {
            if (failure != nullptr)
                *failure = "could not attach Windows input subclass or IME context";
            return nullptr;
        }
        return std::make_unique<WindowsInput>(std::move(state));
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
