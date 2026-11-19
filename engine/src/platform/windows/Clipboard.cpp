#include <soundor/platform/Clipboard.h>

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#include <windows.h>

#include <limits>
#include <memory>
#include <string>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        struct ClipboardSession
        {
            explicit ClipboardSession(HWND owner) : opened(OpenClipboard(owner) != FALSE) {}
            ~ClipboardSession()
            {
                if (opened)
                    CloseClipboard();
            }

            ClipboardSession(const ClipboardSession&) = delete;
            ClipboardSession& operator=(const ClipboardSession&) = delete;

            const bool opened;
        };

        class WindowsClipboard final : public ui::Clipboard
        {
        public:
            std::string readText() override
            {
                const ClipboardSession session(nullptr);
                if (! session.opened)
                    return {};

                HGLOBAL handle = GetClipboardData(CF_UNICODETEXT);
                if (handle == nullptr)
                    return {};
                const auto capacity = GlobalSize(handle) / sizeof(wchar_t);
                const auto unlock = [handle](const wchar_t*) { GlobalUnlock(handle); };
                const std::unique_ptr<const wchar_t, decltype(unlock)> data(
                    static_cast<const wchar_t*>(GlobalLock(handle)), unlock);
                if (data == nullptr)
                    return {};
                const std::wstring_view buffer(data.get(), capacity);
                const auto wide = buffer.substr(0, buffer.find(L'\0'));
                if (wide.empty() || wide.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
                    return {};
                const int units = static_cast<int>(wide.size());
                const int bytes = WideCharToMultiByte(CP_UTF8, 0, wide.data(), units, nullptr, 0, nullptr, nullptr);
                if (bytes == 0)
                    return {};
                std::string text(static_cast<std::size_t>(bytes), '\0');
                WideCharToMultiByte(CP_UTF8, 0, wide.data(), units, text.data(), bytes, nullptr, nullptr);
                std::size_t offset = 0;
                for (std::size_t i = 0; i < text.size(); ++i)
                {
                    if (text[i] == '\r' && i + 1 < text.size() && text[i + 1] == '\n')
                        continue;
                    text[offset++] = text[i];
                }
                text.resize(offset);
                return text;
            }

            void writeText(std::string text) override
            {
                // CF_UNICODETEXT uses CRLF and a terminating NUL.
                std::string lines;
                lines.reserve(text.size());
                for (std::size_t i = 0; i < text.size(); ++i)
                {
                    if (text[i] == '\n' && (i == 0 || text[i - 1] != '\r'))
                        lines.push_back('\r');
                    lines.push_back(text[i]);
                }
                if (lines.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
                    return;
                const int bytes = static_cast<int>(lines.size());
                const int units = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, lines.data(), bytes, nullptr, 0);
                if (units == 0 && bytes != 0)
                    return;

                HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE, (static_cast<std::size_t>(units) + 1) * sizeof(wchar_t));
                if (handle == nullptr)
                    return;
                auto* data = static_cast<wchar_t*>(GlobalLock(handle));
                if (data != nullptr)
                {
                    if (units != 0)
                        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, lines.data(), bytes, data, units);
                    data[units] = L'\0';
                    GlobalUnlock(handle);

                    // SetClipboardData needs a real owner. Use a message-only
                    // window of a built-in class, independent of the host view.
                    HWND window =
                        CreateWindowExW(0, L"STATIC", nullptr, 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, nullptr, nullptr);
                    if (window != nullptr)
                    {
                        {
                            const ClipboardSession session(window);
                            if (session.opened && EmptyClipboard() != FALSE
                                && SetClipboardData(CF_UNICODETEXT, handle) != nullptr)
                                handle = nullptr; // The system now owns the storage.
                        }
                        DestroyWindow(window);
                    }
                }
                if (handle != nullptr)
                    GlobalFree(handle);
            }
        };
    } // namespace

    std::shared_ptr<ui::Clipboard> systemClipboard()
    {
        return std::make_shared<WindowsClipboard>();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
