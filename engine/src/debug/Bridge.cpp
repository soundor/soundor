#include <soundor/debug/Bridge.h>

#if SOUNDOR_DEVTOOLS
    #include <soundor/json/Json.h>

    #include <array>
    #include <atomic>
    #include <charconv>
    #include <condition_variable>
    #include <cstdlib>
    #include <deque>
    #include <fstream>
    #include <future>
    #include <iterator>
    #include <memory>
    #include <mutex>
    #include <thread>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    namespace
    {
        // The DevTools protocol version (`@soundor/devtools-protocol`).
        constexpr int protocolVersion = 2;
        constexpr std::size_t maxMessage = std::size_t { 1024 } * 1024;
        constexpr std::size_t maxQueue = 128;
        constexpr std::size_t maxDescriptor = 65536;

        std::string stringField(const json::Value& value, const char* name)
        {
            const auto* member = value.find(name);
            return member != nullptr && member->isString() ? member->asString() : std::string();
        }
        std::int64_t integerField(const json::Value& value, const char* name)
        {
            const auto* member = value.find(name);
            return member != nullptr ? member->asInt64().value_or(0) : 0;
        }
    } // namespace

    struct Bridge::State
    {
        struct Credentials
        {
            std::string endpoint, session, token, target, targetToken, project;
            unsigned epoch = 0;
        };
        struct Incoming
        {
            unsigned epoch;
            Command command;
        };
        using Outgoing = Bridge::Message;
        struct Response
        {
            int status = 0;
            json::Value body;
        };

        std::string descriptor, name, runtime, project;
        std::shared_ptr<platform::HttpClient> http;
        std::mutex mutex;
        std::condition_variable wake;
        std::deque<Incoming> incoming;
        std::deque<Outgoing> outgoing;
        // The request each worker (0: polling, 1: sending) waits for.
        std::array<std::shared_ptr<platform::CancellationToken>, 2> requests;
        Credentials credentials;
        std::atomic<bool> stopped { false }, connected { false };
        std::atomic<unsigned> epoch { 0 }, generation { 1 };
        std::atomic<int> error { 0 };
        std::thread polling, sending;

        std::optional<Credentials> readDescriptor()
        {
            std::ifstream file(descriptor, std::ios::binary);
            if (! file)
                return {};
            std::string text;
            text.resize(maxDescriptor + 1);
            file.read(text.data(), static_cast<std::streamsize>(text.size()));
            text.resize(static_cast<std::size_t>(file.gcount()));
            if (text.size() > maxDescriptor)
                return {};
            json::Value value;
            try
            {
                value = json::parse(text);
            }
            catch (const json::Error&)
            {
                return {};
            }
            Credentials data { stringField(value, "endpoint"),
                               stringField(value, "sessionId"),
                               stringField(value, "token"),
                               {},
                               {},
                               stringField(value, "project"),
                               0 };
            // The server `soundor dev` runs on this machine, and nothing else.
            constexpr std::string_view prefix = "http://127.0.0.1:";
            if (! data.endpoint.starts_with(prefix) || data.session.empty() || data.session.size() > 128
                || data.token.size() != 64 || data.project.empty())
                return {};
            const auto port = std::string_view(data.endpoint).substr(prefix.size());
            unsigned parsed = 0;
            const auto result = std::from_chars(port.data(), port.data() + port.size(), parsed);
            if (result.ec != std::errc() || result.ptr != port.data() + port.size() || parsed == 0 || parsed > 65535)
                return {};
            if (data.token.find_first_not_of("0123456789abcdef") != std::string::npos
                || data.session.find_first_of("\r\n") != std::string::npos)
                return {};
            if (! project.empty() && data.project != project)
                return {};
            project = data.project;
            return data;
        }

        // A request to the server, waited for on worker `worker`'s thread;
        // nothing when it failed, was cancelled, or its answer is no JSON.
        std::optional<Response> request(const Credentials& data, const std::string& path, const char* method,
                                        const std::string& body, std::size_t worker, bool poll,
                                        const char* contentType = "application/json")
        {
            platform::HttpRequest request;
            request.method = method;
            request.url = data.endpoint + path;
            request.proxy = false;
            request.followRedirects = false;
            request.connectTimeoutMs = 25000;
            // A poll waits until the dashboard has something to say.
            request.timeoutMs = poll ? 0 : 60000;
            // Registration has no target credentials yet: those headers come
            // once issued.
            request.headers = { { "Content-Type", contentType },
                                { "Authorization", "Bearer " + data.token },
                                { "X-Soundor-Session", data.session } };
            if (! data.target.empty())
            {
                request.headers.push_back({ "X-Soundor-Target", data.target });
                request.headers.push_back({ "X-Soundor-Target-Token", data.targetToken });
            }
            request.body.assign(body.begin(), body.end());

            auto token = std::make_shared<platform::CancellationToken>();
            auto promise = std::make_shared<std::promise<platform::HttpClient::Result>>();
            auto future = promise->get_future();
            {
                std::lock_guard lock(mutex);
                if (stopped.load())
                    return {};
                requests[worker] = token;
            }
            http->send(std::move(request), token,
                       [promise](platform::HttpClient::Result result) { promise->set_value(std::move(result)); });
            auto result = future.get();
            {
                std::lock_guard lock(mutex);
                if (requests[worker] == token)
                    requests[worker].reset();
            }
            auto* response = std::get_if<platform::HttpResponse>(&result);
            if (response == nullptr || stopped.load() || response->body.size() > maxMessage)
                return {};
            Response out { response->status, {} };
            if (! response->body.empty())
            {
                try
                {
                    out.body = json::parse(
                        std::string_view(reinterpret_cast<const char*>(response->body.data()), response->body.size()));
                }
                catch (const json::Error&)
                {
                    out.body = {};
                }
            }
            return out;
        }

        void cancel(std::size_t worker)
        {
            std::shared_ptr<platform::CancellationToken> token;
            {
                std::lock_guard lock(mutex);
                token = requests[worker];
            }
            if (token)
                token->cancel();
        }

        void disconnect(unsigned expected)
        {
            {
                std::lock_guard lock(mutex);
                if (credentials.epoch != expected)
                    return;
                connected.store(false);
                credentials = {};
                incoming.clear();
                outgoing.clear();
                ++epoch;
            }
            cancel(0);
            wake.notify_all();
        }

        void poll()
        {
            while (! stopped.load())
            {
                Credentials data;
                {
                    std::lock_guard lock(mutex);
                    data = credentials;
                }
                if (! connected.load())
                {
                    const auto descriptorData = readDescriptor();
                    if (! descriptorData)
                        error.store(1);
                    if (descriptorData)
                    {
                        const auto registration =
                            Value(Value::Object {
                                      { "version", protocolVersion },
                                      { "sessionId", descriptorData->session },
                                      { "name", name },
                                      { "runtime", runtime },
                                      { "generation", generation.load() },
                                      { "capabilities", Value::Array { "inspector", "accessibility", "animations",
                                                                       "performance", "input", "capture" } },
                                  })
                                .json();
                        const auto response =
                            request(*descriptorData, "/runtime/register", "POST", registration, 0, false);
                        if (! response || response->status != 200)
                            error.store(response ? response->status : 503);
                        if (response && response->status == 200
                            && integerField(response->body, "version") == protocolVersion)
                        {
                            data = *descriptorData;
                            data.target = stringField(response->body, "targetId");
                            data.targetToken = stringField(response->body, "targetToken");
                            if (! data.target.empty() && data.targetToken.size() == 64)
                            {
                                std::lock_guard lock(mutex);
                                data.epoch = ++epoch;
                                credentials = data;
                                connected.store(true);
                                error.store(0);
                                wake.notify_all();
                            }
                        }
                    }
                    if (! connected.load())
                    {
                        std::unique_lock lock(mutex);
                        wake.wait_for(lock, std::chrono::milliseconds(500), [&] { return stopped.load(); });
                        continue;
                    }
                }
                const auto response = request(data, "/runtime/poll", "GET", {}, 0, true);
                if (! response || response->status != 200)
                {
                    error.store(response ? response->status : 503);
                    disconnect(data.epoch);
                    continue;
                }
                const auto* commands = response->body.find("commands");
                if (commands == nullptr || ! commands->isArray())
                    continue;
                for (const auto& item : commands->asArray())
                {
                    // The engine decodes commands, for every runtime alike.
                    const auto parsed = Value::parse(json::write(item));
                    auto command = parsed ? Command::parse(*parsed) : std::nullopt;
                    if (! command)
                        continue;
                    std::lock_guard lock(mutex);
                    if (command->method == "cancel")
                    {
                        std::erase_if(incoming, [&](const Incoming& entry) { return entry.command.id == command->id; });
                        continue;
                    }
                    if (data.epoch == credentials.epoch && incoming.size() < maxQueue)
                        incoming.push_back({ data.epoch, std::move(*command) });
                }
            }
        }

        void send()
        {
            while (! stopped.load())
            {
                Outgoing item;
                Credentials data;
                {
                    std::unique_lock lock(mutex);
                    wake.wait(lock, [&] { return stopped.load() || (connected.load() && ! outgoing.empty()); });
                    if (stopped.load())
                        break;
                    item = std::move(outgoing.front());
                    outgoing.pop_front();
                    data = credentials;
                }
                if (item.epoch != data.epoch)
                    continue;
                // A capture's PNG goes first, as binary; the server answers
                // CAPTURE_UNAVAILABLE when the answer comes without it.
                if (! item.attachmentId.empty())
                {
                    const auto uploaded = request(data, "/runtime/captures/" + item.attachmentId, "POST",
                                                  item.attachment, 1, false, "image/png");
                    if (! uploaded || uploaded->status == 401 || uploaded->status == 410)
                    {
                        disconnect(data.epoch);
                        continue;
                    }
                }
                const auto response = request(data, "/runtime/messages", "POST", item.text, 1, false);
                if (! response || response->status == 401 || response->status == 410)
                    disconnect(data.epoch);
            }
        }

        void stop()
        {
            stopped.store(true);
            wake.notify_all();
            cancel(0);
            cancel(1);
            if (polling.joinable())
                polling.join();
            if (sending.joinable())
                sending.join();
        }
    };

    std::string Bridge::sessionFromEnvironment()
    {
        // Read once, while the editor is made, on the UI thread.
    #if defined(_MSC_VER)
        char* value = nullptr;
        std::size_t size = 0;
        const auto error = _dupenv_s(&value, &size, "SOUNDOR_DEVTOOLS_SESSION");
        const std::unique_ptr<char, decltype(&std::free)> owned(value, &std::free);
        return error == 0 && owned ? std::string(owned.get()) : std::string();
    #else
        const char* value = std::getenv("SOUNDOR_DEVTOOLS_SESSION"); // NOLINT(concurrency-mt-unsafe)
        return value != nullptr ? std::string(value) : std::string();
    #endif
    }

    Bridge::Bridge(Options options)
        : state(std::make_shared<State>()),
          inspector(
              [this](std::string message)
              {
                  if (outgoing.size() < maxQueue && state->connected.load())
                      outgoing.push_back({ .epoch = observedEpoch, .text = std::move(message) });
              }),
          log(std::move(options.log))
    {
        state->descriptor = std::move(options.descriptor);
        state->name = std::move(options.name);
        state->runtime = std::move(options.runtime);
        state->http = options.http ? std::move(options.http) : platform::systemHttpClient();
        inspector.attachments(
            [this](std::string id, std::vector<std::uint8_t> attachment, std::string response)
            {
                if (outgoing.size() < maxQueue && state->connected.load())
                    outgoing.push_back({ .epoch = observedEpoch,
                                         .text = std::move(response),
                                         .attachmentId = std::move(id),
                                         .attachment = std::string(attachment.begin(), attachment.end()) });
            });
        try
        {
            state->polling = std::thread(
                [shared = state]
                {
                    try
                    {
                        shared->poll();
                    }
                    catch (...)
                    {
                        shared->disconnect(shared->epoch.load());
                    }
                });
            state->sending = std::thread(
                [shared = state]
                {
                    try
                    {
                        shared->send();
                    }
                    catch (...)
                    {
                        shared->disconnect(shared->epoch.load());
                    }
                });
        }
        catch (...)
        {
            state->stop();
            throw;
        }
    }

    Bridge::~Bridge()
    {
        state->stop();
    }

    void Bridge::tick(RuntimeHost& host, unsigned generation)
    {
        state->generation.store(generation);
        const int error = state->error.load();
        if (error != lastError)
        {
            lastError = error;
            if (log && error != 0)
                log(js::LogLevel::Warn,
                    error == 401   ? "DevTools authentication failed; obtain the current designated session descriptor."
                    : error == 400 ? "DevTools protocol mismatch; use matching Soundor CLI and runtime versions."
                    : error == 1   ? "DevTools session descriptor is unavailable; native UI continues normally."
                                   : "DevTools server disconnected; native UI continues normally, reconnecting to the "
                                     "designated session (status "
                                       + std::to_string(error) + ").");
        }
        const auto epoch = state->epoch.load();
        if (epoch != observedEpoch)
        {
            outgoing.clear();
            inspector.reset(host.surface());
            Command subscriptions;
            subscriptions.method = "subscribe";
            inspector.execute(host, subscriptions);
            observedEpoch = epoch;
            if (state->connected.load())
                outgoing.push_back(
                    { .epoch = observedEpoch,
                      .text = Value(Value::Object { { "type", "event" },
                                                    { "event", "Runtime.generationChanged" },
                                                    { "data", Value::Object { { "generation", generation } } } })
                                  .json() });
        }
        inspector.tick(host, generation);
        std::deque<State::Incoming> commands;
        {
            std::unique_lock lock(state->mutex, std::try_to_lock);
            if (lock)
                for (int count = 0; count < 4 && ! state->incoming.empty(); ++count)
                {
                    commands.push_back(std::move(state->incoming.front()));
                    state->incoming.pop_front();
                }
        }
        for (const auto& item : commands)
            if (item.epoch == state->epoch.load() && state->connected.load())
                inspector.execute(host, item.command);
        {
            std::unique_lock lock(state->mutex, std::try_to_lock);
            if (lock && state->connected.load())
            {
                while (! outgoing.empty() && state->outgoing.size() < maxQueue)
                {
                    state->outgoing.push_back(std::move(outgoing.front()));
                    outgoing.pop_front();
                }
                state->wake.notify_all();
            }
        }
    }

    bool Bridge::pointer(RuntimeHost& host, const ui::PointerInput& input)
    {
        if (! state->connected.load() || state->epoch.load() != observedEpoch)
            inspector.reset(host.surface());
        return inspector.pointer(host.surface(), input);
    }

    bool Bridge::key(RuntimeHost& host, const ui::KeyInput& input)
    {
        if (! state->connected.load() || state->epoch.load() != observedEpoch)
            inspector.reset(host.surface());
        return inspector.key(host.surface(), input);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
