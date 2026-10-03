#pragma once

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

    // ── Host information (backs soundor:host) ────────────────────────────────

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

        friend bool operator==(const Transport&, const Transport&) = default;
    };

    struct HostSnapshot
    {
        double sampleRate = 0;
        int blockSize = 0;
        // e.g. "Reaper", when the backend can tell.
        std::string hostName;
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
