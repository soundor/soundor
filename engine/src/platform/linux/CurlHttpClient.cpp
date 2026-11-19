// systemHttpClient() on Linux: the system's libcurl, loaded when first used.
//
// Never linked, and none of its headers needed: the few functions and
// constants used are declared here, from libcurl.so.4's ABI, which has not
// changed since 2006 (tests/platform/HttpClientTests.cpp exercises each). A
// plugin carries no HTTP or TLS code of its own, and HTTPS is
// as safe as the system keeps its libcurl. All transfers of a client run on
// one thread of its own, in one multi handle.

#include "platform/Http.h"

#include <dlfcn.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace curl
    {
        // libcurl's types and constants (curl/curl.h, curl/multi.h).
        struct Slist;
        struct VersionInfo
        {
            int age;
            const char* version;
            unsigned versionNumber;
            const char* host;
            int features;
        };
        struct Message
        {
            int message;
            void* easy;
            union
            {
                void* whatever;
                int result;
            } data;
        };

        constexpr long globalDefault = 3;
        constexpr int versionNow = 10;
        constexpr int featureHttp3 = 1 << 25;
        constexpr int messageDone = 1;
        constexpr long protocolHttp = 1;
        constexpr long protocolHttps = 2;
        constexpr long httpVersion3 = 30;
        constexpr std::size_t errorSize = 256;
        // CURLoption: long options, then objects (+10000), functions
        // (+20000) and curl_off_t (+30000).
        enum Option : int
        {
            optionNoBody = 44,
            optionPost = 47,
            optionFollowLocation = 52,
            optionMaxRedirects = 68,
            optionHttpGet = 80,
            optionHttpVersion = 84,
            optionNoSignal = 99,
            optionTimeoutMs = 155,
            optionConnectTimeoutMs = 156,
            optionProtocols = 181,
            optionRedirectProtocols = 182,
            optionWriteData = 10001,
            optionUrl = 10002,
            optionErrorBuffer = 10010,
            optionPostFields = 10015,
            optionHttpHeader = 10023,
            optionHeaderData = 10029,
            optionCustomRequest = 10036,
            optionAcceptEncoding = 10102,
            optionPrivate = 10103,
            optionNoProxy = 10177,
            optionWriteFunction = 20011,
            optionHeaderFunction = 20079,
            optionPostFieldSizeLarge = 30120,
        };
        enum Info : int
        {
            infoEffectiveUrl = 0x100000 + 1,
            infoPrivate = 0x100000 + 21,
            infoResponseCode = 0x200000 + 2,
        };

        using Callback = std::size_t (*)(char*, std::size_t, std::size_t, void*);

        struct Library
        {
            int (*global_init)(long) = nullptr;
            VersionInfo* (*version_info)(int) = nullptr;
            void* (*easy_init)() = nullptr;
            void (*easy_cleanup)(void*) = nullptr;
            int (*easy_setopt)(void*, int, ...) = nullptr;
            int (*easy_getinfo)(void*, int, ...) = nullptr;
            const char* (*easy_strerror)(int) = nullptr;
            Slist* (*slist_append)(Slist*, const char*) = nullptr;
            void (*slist_free_all)(Slist*) = nullptr;
            void* (*multi_init)() = nullptr;
            int (*multi_cleanup)(void*) = nullptr;
            int (*multi_add_handle)(void*, void*) = nullptr;
            int (*multi_remove_handle)(void*, void*) = nullptr;
            int (*multi_perform)(void*, int*) = nullptr;
            int (*multi_poll)(void*, void*, unsigned, int, int*) = nullptr;
            int (*multi_wakeup)(void*) = nullptr;
            Message* (*multi_info_read)(void*, int*) = nullptr;

            // Why there is none, when there is none.
            std::string failure;
            // Whether HTTP/3 is asked for: built in, and in a libcurl that
            // falls back from it (7.88 and later).
            bool http3 = false;
        };

        template <typename Function>
        bool resolve(void* handle, const char* name, Function& function)
        {
            function = reinterpret_cast<Function>(dlsym(handle, name)); // NOLINT(*-reinterpret-cast)
            return function != nullptr;
        }

        // Loaded once per process and never unloaded: hosts and other
        // plugins may use the same library, and curl_global_cleanup() would
        // pull it from under them.
        const Library& library()
        {
            static const Library loaded = []
            {
                Library out;
                void* handle = nullptr;
                for (const char* name : { "libcurl.so.4", "libcurl-gnutls.so.4" })
                {
                    handle = dlopen(name, RTLD_NOW | RTLD_LOCAL);
                    if (handle != nullptr)
                        break;
                }
                if (handle == nullptr)
                {
                    out.failure = "HTTPS needs libcurl (libcurl.so.4), which this system lacks";
                    return out;
                }
                const bool complete = resolve(handle, "curl_global_init", out.global_init)
                                      && resolve(handle, "curl_version_info", out.version_info)
                                      && resolve(handle, "curl_easy_init", out.easy_init)
                                      && resolve(handle, "curl_easy_cleanup", out.easy_cleanup)
                                      && resolve(handle, "curl_easy_setopt", out.easy_setopt)
                                      && resolve(handle, "curl_easy_getinfo", out.easy_getinfo)
                                      && resolve(handle, "curl_easy_strerror", out.easy_strerror)
                                      && resolve(handle, "curl_slist_append", out.slist_append)
                                      && resolve(handle, "curl_slist_free_all", out.slist_free_all)
                                      && resolve(handle, "curl_multi_init", out.multi_init)
                                      && resolve(handle, "curl_multi_cleanup", out.multi_cleanup)
                                      && resolve(handle, "curl_multi_add_handle", out.multi_add_handle)
                                      && resolve(handle, "curl_multi_remove_handle", out.multi_remove_handle)
                                      && resolve(handle, "curl_multi_perform", out.multi_perform)
                                      && resolve(handle, "curl_multi_poll", out.multi_poll)
                                      && resolve(handle, "curl_multi_wakeup", out.multi_wakeup)
                                      && resolve(handle, "curl_multi_info_read", out.multi_info_read);
                if (! complete)
                {
                    out = Library {};
                    out.failure = "the system's libcurl is too old (Soundor needs 7.68 or later)";
                    return out;
                }
                if (out.global_init(globalDefault) != 0)
                {
                    out = Library {};
                    out.failure = "the system's libcurl could not be initialized";
                    return out;
                }
                if (const auto* version = out.version_info(versionNow))
                    out.http3 = (version->features & featureHttp3) != 0 && version->versionNumber >= 0x075800;
                return out;
            }();
            return loaded;
        }
    } // namespace curl

    namespace
    {
        class CurlHttpClient final : public HttpClient
        {
        public:
            CurlHttpClient() = default;
            ~CurlHttpClient() override
            {
                {
                    std::lock_guard lock(mutex);
                    stopping = true;
                }
                if (multi != nullptr)
                    curl::library().multi_wakeup(multi);
                if (worker.joinable())
                    worker.join();
                // Never started, or stopped with requests still queued.
                for (auto& transfer : pending)
                    transfer->complete(std::string("aborted"));
                if (multi != nullptr)
                    curl::library().multi_cleanup(multi);
            }

            CurlHttpClient(const CurlHttpClient&) = delete;
            CurlHttpClient& operator=(const CurlHttpClient&) = delete;
            CurlHttpClient(CurlHttpClient&&) = delete;
            CurlHttpClient& operator=(CurlHttpClient&&) = delete;

            void send(HttpRequest request, std::shared_ptr<const CancellationToken> cancellation,
                      Completion complete) override
            {
                const auto& curl = curl::library();
                if (! curl.failure.empty())
                {
                    complete(curl.failure);
                    return;
                }
                auto transfer = std::make_unique<Transfer>();
                transfer->request = std::move(request);
                transfer->cancellation = std::move(cancellation);
                transfer->complete = std::move(complete);
                {
                    std::lock_guard lock(mutex);
                    if (stopping)
                    {
                        transfer->complete(std::string("aborted"));
                        return;
                    }
                    if (multi == nullptr)
                    {
                        multi = curl.multi_init();
                        if (multi == nullptr)
                        {
                            transfer->complete(std::string("the system's libcurl could not start a request"));
                            return;
                        }
                        worker = std::thread([this] { run(); });
                    }
                    pending.push_back(std::move(transfer));
                }
                curl.multi_wakeup(multi);
            }

        private:
            struct Transfer
            {
                HttpRequest request;
                std::shared_ptr<const CancellationToken> cancellation;
                Completion complete;
                void* easy = nullptr;
                curl::Slist* headers = nullptr;
                http::HeaderReader reader;
                std::vector<std::uint8_t> body;
                std::array<char, curl::errorSize> error {};

                Transfer() = default;
                Transfer(const Transfer&) = delete;
                Transfer& operator=(const Transfer&) = delete;
                Transfer(Transfer&&) = delete;
                Transfer& operator=(Transfer&&) = delete;
                ~Transfer()
                {
                    const auto& curl = curl::library();
                    if (easy != nullptr)
                        curl.easy_cleanup(easy);
                    if (headers != nullptr)
                        curl.slist_free_all(headers);
                }
            };

            static std::size_t onBody(char* data, std::size_t size, std::size_t count, void* user)
            {
                auto& transfer = *static_cast<Transfer*>(user);
                if (transfer.cancellation && transfer.cancellation->isCancelled())
                    return 0; // stops the transfer
                const auto bytes = size * count;
                const auto* first = reinterpret_cast<const std::uint8_t*>(data); // NOLINT(*-reinterpret-cast)
                transfer.body.insert(transfer.body.end(), first, first + bytes);
                return bytes;
            }

            static std::size_t onHeader(char* data, std::size_t size, std::size_t count, void* user)
            {
                auto& transfer = *static_cast<Transfer*>(user);
                const auto bytes = size * count;
                transfer.reader.line({ data, bytes });
                return bytes;
            }

            // Sets `transfer` up; an error message when it cannot be.
            std::string configure(Transfer& transfer)
            {
                const auto& curl = curl::library();
                auto& request = transfer.request;
                transfer.easy = curl.easy_init();
                if (transfer.easy == nullptr)
                    return "the system's libcurl could not start a request";
                void* easy = transfer.easy;
                const auto set = [&](int option, auto value) { return curl.easy_setopt(easy, option, value); };
                set(curl::optionPrivate, static_cast<void*>(&transfer));
                set(curl::optionErrorBuffer, transfer.error.data());
                set(curl::optionNoSignal, 1L);
                if (set(curl::optionUrl, request.url.c_str()) != 0)
                    return "invalid URL " + request.url;
                set(curl::optionProtocols, curl::protocolHttp | curl::protocolHttps);
                set(curl::optionRedirectProtocols, curl::protocolHttp | curl::protocolHttps);
                set(curl::optionFollowLocation, request.followRedirects ? 1L : 0L);
                set(curl::optionMaxRedirects, 20L);
                set(curl::optionConnectTimeoutMs, static_cast<long>(request.connectTimeoutMs));
                set(curl::optionTimeoutMs, static_cast<long>(request.timeoutMs));
                if (! request.proxy)
                    set(curl::optionNoProxy, "*");
                // Every encoding this libcurl decodes; the body arrives decoded.
                set(curl::optionAcceptEncoding, "");
                if (curl.http3 && request.url.starts_with("https://"))
                    set(curl::optionHttpVersion, curl::httpVersion3);

                const bool hasBody = ! request.body.empty()
                                     || (request.method != "GET" && request.method != "HEAD"
                                         && request.method != "DELETE" && request.method != "OPTIONS");
                if (request.method == "HEAD")
                    set(curl::optionNoBody, 1L);
                else if (request.method == "GET" && request.body.empty())
                    set(curl::optionHttpGet, 1L);
                else if (hasBody)
                {
                    set(curl::optionPost, 1L);
                    set(curl::optionPostFieldSizeLarge, static_cast<std::int64_t>(request.body.size()));
                    set(curl::optionPostFields, request.body.empty() ? static_cast<const void*>("")
                                                                     : static_cast<const void*>(request.body.data()));
                    if (request.method != "POST")
                        set(curl::optionCustomRequest, request.method.c_str());
                }
                else
                    set(curl::optionCustomRequest, request.method.c_str());

                const auto header = [&](const std::string& line)
                {
                    if (auto* appended = curl.slist_append(transfer.headers, line.c_str()))
                        transfer.headers = appended;
                };
                for (const auto& [name, value] : request.headers)
                {
                    if (name.find_first_of("\r\n") != std::string::npos
                        || value.find_first_of("\r\n") != std::string::npos)
                        return "invalid header " + name;
                    // "Name;" is how libcurl sends a header with no value.
                    std::string line = name;
                    if (value.empty())
                        line += ';';
                    else
                    {
                        line += ": ";
                        line += value;
                    }
                    header(line);
                }
                // No "Expect: 100-continue" round trip, and no form content
                // type libcurl would add to a body that has none.
                header("Expect:");
                if (hasBody && ! http::hasHeader(request.headers, "Content-Type"))
                    header("Content-Type:");
                set(curl::optionHttpHeader, transfer.headers);
                set(curl::optionWriteFunction, static_cast<curl::Callback>(&onBody));
                set(curl::optionWriteData, static_cast<void*>(&transfer));
                set(curl::optionHeaderFunction, static_cast<curl::Callback>(&onHeader));
                set(curl::optionHeaderData, static_cast<void*>(&transfer));
                return {};
            }

            static void finish(Transfer& transfer, int code)
            {
                const auto& curl = curl::library();
                if (transfer.cancellation && transfer.cancellation->isCancelled())
                {
                    transfer.complete(std::string("aborted"));
                    return;
                }
                if (code != 0)
                {
                    std::string message = transfer.error.front() != '\0' ? std::string(transfer.error.data())
                                                                         : std::string(curl.easy_strerror(code));
                    transfer.complete(std::move(message));
                    return;
                }
                HttpResponse response;
                long status = 0;
                curl.easy_getinfo(transfer.easy, curl::infoResponseCode, &status);
                response.status = static_cast<int>(status);
                const char* url = nullptr;
                curl.easy_getinfo(transfer.easy, curl::infoEffectiveUrl, &url);
                response.url = url != nullptr ? url : transfer.request.url;
                response.statusText = transfer.reader.statusText();
                if (response.statusText.empty())
                    response.statusText = std::string(http::reasonPhrase(response.status));
                response.headers = std::move(transfer.reader.headers());
                response.body = std::move(transfer.body);
                transfer.complete(std::move(response));
            }

            void run()
            {
                const auto& curl = curl::library();
                std::vector<std::unique_ptr<Transfer>> active;
                const auto remove = [&](Transfer* transfer)
                {
                    curl.multi_remove_handle(multi, transfer->easy);
                    const auto found = std::find_if(active.begin(), active.end(),
                                                    [&](const auto& item) { return item.get() == transfer; });
                    std::unique_ptr<Transfer> owned = std::move(*found);
                    active.erase(found);
                    return owned;
                };
                for (;;)
                {
                    std::deque<std::unique_ptr<Transfer>> arrived;
                    {
                        std::lock_guard lock(mutex);
                        if (stopping)
                            break;
                        arrived.swap(pending);
                    }
                    for (auto& transfer : arrived)
                    {
                        if (auto failure = configure(*transfer); ! failure.empty())
                        {
                            transfer->complete(std::move(failure));
                            continue;
                        }
                        if (curl.multi_add_handle(multi, transfer->easy) != 0)
                        {
                            transfer->complete(std::string("the system's libcurl could not start a request"));
                            continue;
                        }
                        active.push_back(std::move(transfer));
                    }
                    int running = 0;
                    curl.multi_perform(multi, &running);
                    int queued = 0;
                    while (const auto* message = curl.multi_info_read(multi, &queued))
                    {
                        if (message->message != curl::messageDone)
                            continue;
                        void* data = nullptr;
                        curl.easy_getinfo(message->easy, curl::infoPrivate, &data);
                        const int code = message->data.result;
                        auto owned = remove(static_cast<Transfer*>(data));
                        finish(*owned, code);
                    }
                    for (std::size_t index = 0; index < active.size();)
                    {
                        auto& transfer = active[index];
                        if (transfer->cancellation && transfer->cancellation->isCancelled())
                        {
                            auto owned = remove(transfer.get());
                            owned->complete(std::string("aborted"));
                            continue;
                        }
                        ++index;
                    }
                    // A cancellation is noticed within this.
                    curl.multi_poll(multi, nullptr, 0, 50, nullptr);
                }
                for (auto& transfer : active)
                {
                    curl.multi_remove_handle(multi, transfer->easy);
                    transfer->complete(std::string("aborted"));
                }
            }

            std::mutex mutex;
            std::deque<std::unique_ptr<Transfer>> pending;
            bool stopping = false;
            void* multi = nullptr;
            std::thread worker;
        };
    } // namespace

    std::shared_ptr<HttpClient> systemHttpClient()
    {
        return std::make_shared<CurlHttpClient>();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
