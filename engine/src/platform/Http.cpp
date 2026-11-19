#include "platform/Http.h"

#include <algorithm>
#include <cctype>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::http
{
    namespace
    {
        std::string_view trim(std::string_view text) noexcept
        {
            while (! text.empty() && (text.front() == ' ' || text.front() == '\t'))
                text.remove_prefix(1);
            while (! text.empty()
                   && (text.back() == ' ' || text.back() == '\t' || text.back() == '\r' || text.back() == '\n'))
                text.remove_suffix(1);
            return text;
        }
    } // namespace

    bool isHeaderName(std::string_view name) noexcept
    {
        constexpr std::string_view symbols = "!#$%&'*+-.^_`|~";
        return ! name.empty()
               && std::all_of(name.begin(), name.end(),
                              [&](char c) {
                                  return std::isalnum(static_cast<unsigned char>(c)) != 0
                                         || symbols.find(c) != std::string_view::npos;
                              });
    }

    std::string_view reasonPhrase(int status) noexcept
    {
        switch (status)
        {
            case 100:
                return "Continue";
            case 101:
                return "Switching Protocols";
            case 200:
                return "OK";
            case 201:
                return "Created";
            case 202:
                return "Accepted";
            case 203:
                return "Non-Authoritative Information";
            case 204:
                return "No Content";
            case 205:
                return "Reset Content";
            case 206:
                return "Partial Content";
            case 300:
                return "Multiple Choices";
            case 301:
                return "Moved Permanently";
            case 302:
                return "Found";
            case 303:
                return "See Other";
            case 304:
                return "Not Modified";
            case 307:
                return "Temporary Redirect";
            case 308:
                return "Permanent Redirect";
            case 400:
                return "Bad Request";
            case 401:
                return "Unauthorized";
            case 402:
                return "Payment Required";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 405:
                return "Method Not Allowed";
            case 406:
                return "Not Acceptable";
            case 407:
                return "Proxy Authentication Required";
            case 408:
                return "Request Timeout";
            case 409:
                return "Conflict";
            case 410:
                return "Gone";
            case 411:
                return "Length Required";
            case 412:
                return "Precondition Failed";
            case 413:
                return "Content Too Large";
            case 414:
                return "URI Too Long";
            case 415:
                return "Unsupported Media Type";
            case 416:
                return "Range Not Satisfiable";
            case 417:
                return "Expectation Failed";
            case 421:
                return "Misdirected Request";
            case 422:
                return "Unprocessable Content";
            case 426:
                return "Upgrade Required";
            case 428:
                return "Precondition Required";
            case 429:
                return "Too Many Requests";
            case 431:
                return "Request Header Fields Too Large";
            case 451:
                return "Unavailable For Legal Reasons";
            case 500:
                return "Internal Server Error";
            case 501:
                return "Not Implemented";
            case 502:
                return "Bad Gateway";
            case 503:
                return "Service Unavailable";
            case 504:
                return "Gateway Timeout";
            case 505:
                return "HTTP Version Not Supported";
            default:
                return {};
        }
    }

    bool hasHeader(const std::vector<HttpHeader>& headers, std::string_view name) noexcept
    {
        return std::any_of(headers.begin(), headers.end(),
                           [&](const HttpHeader& header)
                           {
                               return header.name.size() == name.size()
                                      && std::equal(header.name.begin(), header.name.end(), name.begin(),
                                                    [](char a, char b) {
                                                        return std::tolower(static_cast<unsigned char>(a))
                                                               == std::tolower(static_cast<unsigned char>(b));
                                                    });
                           });
    }

    void HeaderReader::line(std::string_view text)
    {
        text = trim(text);
        if (text.empty())
            return;
        if (text.starts_with("HTTP/"))
        {
            // "HTTP/1.1 200 OK": the reason is what follows the code.
            fields.clear();
            reason.clear();
            const auto code = text.find(' ');
            if (code != std::string_view::npos)
            {
                const auto phrase = text.find(' ', code + 1);
                if (phrase != std::string_view::npos)
                    reason = std::string(trim(text.substr(phrase + 1)));
            }
            return;
        }
        const auto colon = text.find(':');
        if (colon == std::string_view::npos)
            return;
        const auto name = text.substr(0, colon);
        if (! isHeaderName(name))
            return;
        fields.push_back({ std::string(name), std::string(trim(text.substr(colon + 1))) });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::http
