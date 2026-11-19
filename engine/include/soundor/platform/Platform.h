#pragma once

#include <soundor/Abi.h>

// The services a backend provides to a plugin's JavaScript runtime. All are
// optional: a missing service makes the APIs that need it fail clearly.

#include <soundor/Config.h>

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    // ── HTTP (backs fetch) ───────────────────────────────────────────────────

    struct HttpHeader
    {
        std::string name;
        std::string value;
    };

    struct HttpRequest
    {
        std::string method;
        std::string url;
        std::vector<HttpHeader> headers;
        std::vector<std::uint8_t> body;
        // Whether the system's proxy settings apply. DevTools' requests to
        // the local server go direct, whatever proxy the system names.
        bool proxy = true;
        // Whether redirects are followed (as fetch() does, up to the
        // platform's limit) or come back as responses.
        bool followRedirects = true;
        // Milliseconds to connect, and for the whole request; 0: no limit
        // (a long poll waits for as long as it takes).
        std::uint32_t connectTimeoutMs = 30000;
        std::uint32_t timeoutMs = 0;
    };

    struct HttpResponse
    {
        int status = 0;
        std::string statusText;
        std::vector<HttpHeader> headers;
        std::vector<std::uint8_t> body;
        // The final URL, after redirects.
        std::string url;
    };

    // Set when JavaScript aborts a request. Clients should stop work early;
    // a late completion is ignored either way.
    class CancellationToken
    {
    public:
        [[nodiscard]] bool isCancelled() const noexcept { return cancelled.load(std::memory_order_acquire); }
        void cancel() noexcept { cancelled.store(true, std::memory_order_release); }

    private:
        std::atomic<bool> cancelled { false };
    };

    class HttpClient
    {
    public:
        // A response, or a network-level error message.
        using Result = std::variant<HttpResponse, std::string>;
        using Completion = std::function<void(Result)>;

        virtual ~HttpClient() = default;

        // Starts `request` without blocking the calling (UI) thread and calls
        // `complete` exactly once, from any thread.
        virtual void send(HttpRequest request, std::shared_ptr<const CancellationToken> cancellation,
                          Completion complete) = 0;
    };

    // The system's own HTTP stack, never one of Soundor's: NSURLSession on
    // macOS and iOS, WinHTTP on Windows, and on Linux the system's libcurl,
    // loaded when first used (libcurl.so.4, else libcurl-gnutls.so.4), so
    // HTTPS and its certificates are what the system keeps up to date, and
    // HTTP/3 is used where the system's stack has it. Where Linux has no
    // libcurl, every request fails, saying so. Requests run on the client's
    // own threads; a cancelled one stops within about 50 ms and completes
    // with "aborted". Destroying the client completes what is left that way.
    [[nodiscard]] std::shared_ptr<HttpClient> systemHttpClient();

    // ── Host information (backs soundor:host) ────────────────────────────────

    struct HostEnvironment
    {
        std::string runtime = "unknown";
        std::string runtimeVersion;
        std::string platform = "unknown";
        std::string arch = "unknown";
        std::string format = "unknown";
    };

    struct Timecode
    {
        double framesPerSecond = 0;
        bool dropFrame = false;
        std::optional<double> smpteOffsetSubframes;
        friend bool operator==(const Timecode&, const Timecode&) = default;
    };

    struct TrackInfo
    {
        std::optional<std::string> name;
        std::optional<std::string> color;
        std::optional<int> index;
        std::optional<std::string> id;
        friend bool operator==(const TrackInfo&, const TrackInfo&) = default;
    };

    struct Transport
    {
        bool playing = false;
        bool recording = false;
        bool looping = false;
        double bpm = 0;
        int timeSignatureNumerator = 4;
        int timeSignatureDenominator = 4;
        // Musical position in quarter notes, and the bar it is in.
        double ppqPosition = 0;
        double barStartPpq = 0;
        double timeInSeconds = 0;
        std::int64_t timeInSamples = 0;
        std::optional<double> loopStartPpq;
        std::optional<double> loopEndPpq;
        std::optional<Timecode> timecode;

        friend bool operator==(const Transport&, const Transport&) = default;
    };

    struct HostSnapshot
    {
        double sampleRate = 0;
        int blockSize = 0;
        // e.g. "Reaper", when the backend can tell.
        std::string hostName;
        std::optional<std::string> hostVersion;
        std::string samplePrecision = "unknown";
        std::string processingMode = "unknown";
        std::optional<TrackInfo> track;
        // Absent when the host reports no transport (or no audio has run yet).
        std::optional<Transport> transport;

        friend bool operator==(const HostSnapshot&, const HostSnapshot&) = default;
    };

    // Read on the UI thread; backends capture realtime state (the play head)
    // on the audio thread without locking and expose the latest copy here.
    class HostInfo
    {
    public:
        virtual ~HostInfo() = default;
        [[nodiscard]] virtual HostSnapshot snapshot() const = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
