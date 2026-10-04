#pragma once

// Private to soundor_runtime: the per-context state behind the Web platform
// layer and the soundor:host/storage/fs modules.

#include "js/Bindings.h"
#include "platform/WorkerThread.h"

#include <soundor/platform/Platform.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    // What the backend provides (all optional).
    struct Services
    {
        std::shared_ptr<platform::HttpClient> http;
        // This plugin's private data directory (storage and soundor:fs live in
        // it). Empty: those modules reject every operation.
        std::filesystem::path dataDirectory;
        std::shared_ptr<platform::HostInfo> hostInfo;
        std::string pluginId;
        std::string pluginName;
    };

    struct State;

    // Runs on the UI thread when taken from the completion queue.
    using Completion = std::function<void(State&, JSContext*)>;
    using CompletionQueue = platform::HandoffQueue<Completion>;

    struct State
    {
        explicit State(Services provided);
        ~State();

        State(const State&) = delete;
        State& operator=(const State&) = delete;

        // Milliseconds since this context's time origin (performance.now()).
        [[nodiscard]] double now() const;

        // ── Asynchronous operations ──────────────────────────────────────────
        //
        // An operation is identified by an id; background threads carry only
        // the id and plain C++ results, and post a Completion that settles the
        // promise on the UI thread.

        // Creates the operation's promise (or returns JS_EXCEPTION).
        JSValue beginOperation(JSContext* ctx, const char* name, std::uint64_t& id);

        // Settles operation `id` with makeValue(ctx), if it is still pending.
        template <typename MakeValue>
        void resolve(std::uint64_t id, MakeValue&& makeValue)
        {
            if (auto pending = takeOperation(id))
                js::bind::resolvePromise(*pending, std::forward<MakeValue>(makeValue));
        }

        // Rejects operation `id` with an error of `kind`: "TypeError", "Error",
        // or "DOMException:<name>".
        void reject(std::uint64_t id, std::string_view kind, std::string_view message);

        [[nodiscard]] std::shared_ptr<js::detail::PendingPromise> takeOperation(std::uint64_t id);

        // The worker thread for blocking file work, started on first use.
        platform::WorkerThread& worker();

        Services services;
        std::chrono::steady_clock::time_point origin;
        double timeOrigin; // Unix time of the origin, in milliseconds
        double nextTimerWake = std::numeric_limits<double>::infinity();
        std::shared_ptr<CompletionQueue> completions = std::make_shared<CompletionQueue>();
        std::unordered_map<std::uint64_t, std::shared_ptr<js::detail::PendingPromise>> operations;
        std::unordered_map<std::uint64_t, std::shared_ptr<platform::CancellationToken>> cancellations;
        std::uint64_t nextOperationId = 1;
        std::optional<platform::HostSnapshot> lastHostSnapshot;

    private:
        std::unique_ptr<platform::WorkerThread> fileWorker;
    };

    // The state of the context `ctx` belongs to, or nullptr when the platform
    // layer is not installed.
    [[nodiscard]] State* stateOf(JSContext* ctx);

    // A new error object: new TypeError(message), new Error(message), or
    // new DOMException(message, name) for "DOMException:<name>".
    JSValue makeError(JSContext* ctx, std::string_view kind, std::string_view message);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
