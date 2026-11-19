#pragma once

// What the system HTTP clients (systemHttpClient()) share: Fetch's rules for
// header names, the standard reason phrases, and reading a raw header block.

#include <soundor/platform/Platform.h>

#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::http
{
    // An HTTP token (RFC 9110), as Fetch requires of header names.
    [[nodiscard]] bool isHeaderName(std::string_view name) noexcept;
    // The standard reason phrase of `status` (RFC 9110), or "".
    [[nodiscard]] std::string_view reasonPhrase(int status) noexcept;
    // Whether `headers` names `name` (case-insensitively).
    [[nodiscard]] bool hasHeader(const std::vector<HttpHeader>& headers, std::string_view name) noexcept;

    // Reads a response's header lines as they arrive, one at a time (with
    // or without their CRLF). A status line starts a response over: what
    // came before was a redirect's or an interim (1xx) response's.
    class HeaderReader
    {
    public:
        void line(std::string_view text);
        // The last status line's reason phrase ("" in HTTP/2 and 3, which
        // have none).
        [[nodiscard]] const std::string& statusText() const noexcept { return reason; }
        [[nodiscard]] std::vector<HttpHeader>& headers() noexcept { return fields; }

    private:
        std::string reason;
        std::vector<HttpHeader> fields;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::http
