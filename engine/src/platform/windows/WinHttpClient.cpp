// systemHttpClient() on Windows: WinHTTP, the system's HTTP stack for
// applications and services (HTTP/2, and HTTP/3 from Windows 11), with the
// system's proxy settings and certificate store.
//
// Each request runs synchronously on a thread of its own; a cancelled one
// has its handles closed from the watcher thread, which WinHTTP documents as
// the way to stop a call in progress.

#include "platform/Http.h"

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#include <windows.h>
#include <winhttp.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cwchar>
#include <list>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

// Newer SDKs' names, for older SDKs (the values are WinHTTP's).
#ifndef WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL
    #define WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL 133
#endif
#ifndef WINHTTP_PROTOCOL_FLAG_HTTP2
    #define WINHTTP_PROTOCOL_FLAG_HTTP2 0x1
#endif
#ifndef WINHTTP_PROTOCOL_FLAG_HTTP3
    #define WINHTTP_PROTOCOL_FLAG_HTTP3 0x2
#endif
#ifndef WINHTTP_OPTION_DECOMPRESSION
    #define WINHTTP_OPTION_DECOMPRESSION 118
#endif
#ifndef WINHTTP_DECOMPRESSION_FLAG_ALL
    #define WINHTTP_DECOMPRESSION_FLAG_ALL 0x3
#endif
#ifndef WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY
    #define WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY 4
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        std::wstring wide(std::string_view text)
        {
            if (text.empty())
                return {};
            const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
            std::wstring out(static_cast<std::size_t>(std::max(size, 0)), L'\0');
            if (size > 0)
                MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size);
            return out;
        }

        std::string narrow(std::wstring_view text)
        {
            if (text.empty())
                return {};
            const int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0,
                                                 nullptr, nullptr);
            std::string out(static_cast<std::size_t>(std::max(size, 0)), '\0');
            if (size > 0)
                WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size, nullptr,
                                    nullptr);
            return out;
        }

        std::string describe(DWORD error)
        {
            switch (error)
            {
                case ERROR_WINHTTP_TIMEOUT:
                    return "the request timed out";
                case ERROR_WINHTTP_NAME_NOT_RESOLVED:
                    return "the server's name could not be resolved";
                case ERROR_WINHTTP_CANNOT_CONNECT:
                    return "could not connect to the server";
                case ERROR_WINHTTP_CONNECTION_ERROR:
                    return "the connection was reset";
                case ERROR_WINHTTP_SECURE_FAILURE:
                    return "the server's certificate is not trusted";
                case ERROR_WINHTTP_REDIRECT_FAILED:
                    return "a redirect failed";
                case ERROR_WINHTTP_UNRECOGNIZED_SCHEME:
                case ERROR_WINHTTP_INVALID_URL:
                    return "invalid URL";
                default:
                    return "WinHTTP error " + std::to_string(error);
            }
        }

        // A WinHTTP handle, closed once (by its owner, or by a cancellation).
        struct Handle
        {
            HINTERNET value = nullptr;
            Handle() = default;
            explicit Handle(HINTERNET handle) : value(handle) {}
            Handle(const Handle&) = delete;
            Handle& operator=(const Handle&) = delete;
            Handle(Handle&&) = delete;
            Handle& operator=(Handle&&) = delete;
            ~Handle()
            {
                if (value != nullptr)
                    WinHttpCloseHandle(value);
            }
        };

        HINTERNET openSession(bool proxy)
        {
            HINTERNET session = nullptr;
            if (proxy)
            {
                session = WinHttpOpen(L"Soundor", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
                                      WINHTTP_NO_PROXY_BYPASS, 0);
                if (session == nullptr) // before Windows 8.1
                    session = WinHttpOpen(L"Soundor", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME,
                                          WINHTTP_NO_PROXY_BYPASS, 0);
            }
            else
                session = WinHttpOpen(L"Soundor", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME,
                                      WINHTTP_NO_PROXY_BYPASS, 0);
            if (session == nullptr)
                return nullptr;
            // HTTP/3 where Windows has it (11 and later), else HTTP/2.
            DWORD protocols = WINHTTP_PROTOCOL_FLAG_HTTP2 | WINHTTP_PROTOCOL_FLAG_HTTP3;
            if (! WinHttpSetOption(session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &protocols, sizeof protocols))
            {
                protocols = WINHTTP_PROTOCOL_FLAG_HTTP2;
                WinHttpSetOption(session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &protocols, sizeof protocols);
            }
            DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_ALL;
            WinHttpSetOption(session, WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof decompression);
            return session;
        }

        class WinHttpClient final : public HttpClient
        {
        public:
            WinHttpClient() : watcher([this] { watch(); }) {}

            ~WinHttpClient() override
            {
                {
                    std::lock_guard lock(mutex);
                    stopping = true;
                    for (auto& job : jobs)
                        closeRequest(job);
                }
                wake.notify_all();
                watcher.join();
                for (auto& job : jobs)
                    if (job.thread.joinable())
                        job.thread.join();
                for (HINTERNET session : sessions)
                    if (session != nullptr)
                        WinHttpCloseHandle(session);
            }

            WinHttpClient(const WinHttpClient&) = delete;
            WinHttpClient& operator=(const WinHttpClient&) = delete;
            WinHttpClient(WinHttpClient&&) = delete;
            WinHttpClient& operator=(WinHttpClient&&) = delete;

            void send(HttpRequest request, std::shared_ptr<const CancellationToken> cancellation,
                      Completion complete) override
            {
                std::lock_guard lock(mutex);
                // Threads of requests that finished.
                for (auto it = jobs.begin(); it != jobs.end();)
                {
                    if (it->finished.load())
                    {
                        it->thread.join();
                        it = jobs.erase(it);
                    }
                    else
                        ++it;
                }
                if (stopping)
                {
                    complete(std::string("aborted"));
                    return;
                }
                const std::size_t index = request.proxy ? 0 : 1;
                if (sessions[index] == nullptr)
                    sessions[index] = openSession(request.proxy);
                if (sessions[index] == nullptr)
                {
                    complete(describe(GetLastError()));
                    return;
                }
                auto& job = jobs.emplace_back();
                job.cancellation = std::move(cancellation);
                job.thread = std::thread(
                    [this, &job, session = sessions[index], request = std::move(request),
                     complete = std::move(complete)]() mutable
                    {
                        auto result = perform(job, session, request);
                        if (job.cancellation && job.cancellation->isCancelled())
                            result = std::string("aborted");
                        {
                            std::lock_guard guard(mutex);
                            closeRequest(job);
                        }
                        complete(std::move(result));
                        job.finished.store(true);
                    });
            }

        private:
            struct Job
            {
                std::shared_ptr<const CancellationToken> cancellation;
                HINTERNET request = nullptr; // closed under the mutex
                HINTERNET connection = nullptr;
                std::thread thread;
                std::atomic<bool> finished { false };
            };

            static void closeRequest(Job& job)
            {
                if (job.request != nullptr)
                    WinHttpCloseHandle(std::exchange(job.request, nullptr));
                if (job.connection != nullptr)
                    WinHttpCloseHandle(std::exchange(job.connection, nullptr));
            }

            Result perform(Job& job, HINTERNET session, const HttpRequest& request)
            {
                const std::wstring url = wide(request.url);
                URL_COMPONENTS parts {};
                parts.dwStructSize = sizeof parts;
                parts.dwSchemeLength = static_cast<DWORD>(-1);
                parts.dwHostNameLength = static_cast<DWORD>(-1);
                parts.dwUrlPathLength = static_cast<DWORD>(-1);
                parts.dwExtraInfoLength = static_cast<DWORD>(-1);
                if (! WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.size()), 0, &parts)
                    || (parts.nScheme != INTERNET_SCHEME_HTTP && parts.nScheme != INTERNET_SCHEME_HTTPS))
                    return "invalid URL " + request.url;
                const std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
                std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
                path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
                if (path.empty())
                    path = L"/";

                HINTERNET connection = WinHttpConnect(session, host.c_str(), parts.nPort, 0);
                if (connection == nullptr)
                    return describe(GetLastError());
                HINTERNET handle = WinHttpOpenRequest(connection, wide(request.method).c_str(), path.c_str(), nullptr,
                                                      WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                      parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
                {
                    std::lock_guard lock(mutex);
                    job.connection = connection;
                    job.request = handle;
                    if (handle == nullptr)
                        return describe(GetLastError());
                    if (stopping)
                        return std::string("aborted");
                }

                // 0: no limit, as WinHTTP reads it.
                const int connect = static_cast<int>(request.connectTimeoutMs);
                const int transfer = static_cast<int>(request.timeoutMs);
                WinHttpSetTimeouts(handle, 0, connect, transfer, transfer);
                if (! request.followRedirects)
                {
                    DWORD policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
                    WinHttpSetOption(handle, WINHTTP_OPTION_REDIRECT_POLICY, &policy, sizeof policy);
                }
                std::wstring headers;
                for (const auto& [name, value] : request.headers)
                {
                    if (name.find_first_of("\r\n") != std::string::npos
                        || value.find_first_of("\r\n") != std::string::npos)
                        return "invalid header " + name;
                    headers += wide(name) + L": " + wide(value) + L"\r\n";
                }
                auto* body = request.body.empty() ? WINHTTP_NO_REQUEST_DATA
                                                  : const_cast<std::uint8_t*>(request.body.data()); // NOLINT
                const auto size = static_cast<DWORD>(request.body.size());
                if (! WinHttpSendRequest(handle, headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headers.c_str(),
                                         headers.empty() ? 0 : static_cast<DWORD>(-1L), body, size, size, 0)
                    || ! WinHttpReceiveResponse(handle, nullptr))
                    return describe(GetLastError());

                HttpResponse response;
                DWORD status = 0;
                DWORD length = sizeof status;
                WinHttpQueryHeaders(handle, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                    WINHTTP_HEADER_NAME_BY_INDEX, &status, &length, WINHTTP_NO_HEADER_INDEX);
                response.status = static_cast<int>(status);

                const auto query = [&](DWORD info) -> std::wstring
                {
                    DWORD bytes = 0;
                    WinHttpQueryHeaders(handle, info, WINHTTP_HEADER_NAME_BY_INDEX, WINHTTP_NO_OUTPUT_BUFFER, &bytes,
                                        WINHTTP_NO_HEADER_INDEX);
                    if (bytes == 0)
                        return {};
                    std::wstring text(bytes / sizeof(wchar_t), L'\0');
                    if (! WinHttpQueryHeaders(handle, info, WINHTTP_HEADER_NAME_BY_INDEX, text.data(), &bytes,
                                              WINHTTP_NO_HEADER_INDEX))
                        return {};
                    text.resize(bytes / sizeof(wchar_t));
                    return text;
                };
                http::HeaderReader reader;
                const std::string raw = narrow(query(WINHTTP_QUERY_RAW_HEADERS_CRLF));
                for (std::size_t start = 0; start < raw.size();)
                {
                    auto end = raw.find("\r\n", start);
                    if (end == std::string::npos)
                        end = raw.size();
                    reader.line(std::string_view(raw).substr(start, end - start));
                    start = end + 2;
                }
                response.headers = std::move(reader.headers());
                response.statusText = narrow(query(WINHTTP_QUERY_STATUS_TEXT));
                if (response.statusText.empty())
                    response.statusText = std::string(http::reasonPhrase(response.status));

                DWORD urlBytes = 0;
                WinHttpQueryOption(handle, WINHTTP_OPTION_URL, nullptr, &urlBytes);
                if (urlBytes != 0)
                {
                    std::wstring final(urlBytes / sizeof(wchar_t), L'\0');
                    if (WinHttpQueryOption(handle, WINHTTP_OPTION_URL, final.data(), &urlBytes))
                    {
                        final.resize(wcsnlen(final.c_str(), final.size()));
                        response.url = narrow(final);
                    }
                }
                if (response.url.empty())
                    response.url = request.url;

                for (;;)
                {
                    DWORD available = 0;
                    if (! WinHttpQueryDataAvailable(handle, &available))
                        return describe(GetLastError());
                    if (available == 0)
                        break;
                    const auto offset = response.body.size();
                    response.body.resize(offset + available);
                    DWORD read = 0;
                    if (! WinHttpReadData(handle, response.body.data() + offset, available, &read))
                        return describe(GetLastError());
                    response.body.resize(offset + read);
                }
                return response;
            }

            // Closes the handles of cancelled requests, within 50 ms.
            void watch()
            {
                std::unique_lock lock(mutex);
                while (! stopping)
                {
                    wake.wait_for(lock, std::chrono::milliseconds(50));
                    for (auto& job : jobs)
                        if (job.cancellation && job.cancellation->isCancelled() && ! job.finished.load())
                            closeRequest(job);
                }
            }

            std::mutex mutex;
            std::condition_variable wake;
            std::list<Job> jobs; // stable addresses, for the threads
            std::array<HINTERNET, 2> sessions {};
            bool stopping = false;
            std::thread watcher;
        };
    } // namespace

    std::shared_ptr<HttpClient> systemHttpClient()
    {
        return std::make_shared<WinHttpClient>();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
