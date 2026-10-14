#include "JuceDebugBridge.h"

#if SOUNDOR_DEVTOOLS
    #include <juce_core/juce_core.h>

    #include <array>
    #include <atomic>
    #include <charconv>
    #include <condition_variable>
    #include <deque>
    #include <mutex>
    #include <thread>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        constexpr std::size_t maxMessage = 1024 * 1024;
        constexpr std::size_t maxQueue = 128;
        juce::var property(const juce::var& value, const char* name)
        {
            return value.getProperty(name, {});
        }
        std::string string(const juce::var& value, const char* name)
        {
            return property(value, name).toString().toStdString();
        }
        unsigned number(const juce::var& value, const char* name)
        {
            return static_cast<unsigned>(static_cast<juce::int64>(property(value, name)));
        }
        ui::NodeId nodeId(const juce::var& value)
        {
            const auto text = string(value, "id");
            ui::NodeId id = ui::noNode;
            const auto result = std::from_chars(text.data(), text.data() + text.size(), id);
            return result.ec == std::errc() && result.ptr == text.data() + text.size() ? id : ui::noNode;
        }
    } // namespace

    struct JuceDebugBridge::State
    {
        struct Credentials
        {
            std::string endpoint, session, token, target, targetToken, project;
            unsigned epoch = 0;
        };
        struct Incoming
        {
            unsigned epoch;
            debug::Command command;
        };
        struct Outgoing
        {
            unsigned epoch;
            std::string message;
        };
        std::string descriptor, name, project;
        std::mutex mutex;
        std::condition_variable wake;
        std::deque<Incoming> incoming;
        std::deque<Outgoing> outgoing;
        std::array<std::shared_ptr<juce::WebInputStream>, 2> streams;
        Credentials credentials;
        std::atomic<bool> stopped { false }, connected { false };
        std::atomic<unsigned> epoch { 0 }, generation { 1 };
        std::atomic<int> error { 0 };
        std::thread polling, sending;

        State(std::string path, std::string label) : descriptor(std::move(path)), name(std::move(label)) {}
        void emit(std::string message)
        {
            if (! connected.load())
                return;
            std::unique_lock lock(mutex, std::try_to_lock);
            if (! lock || outgoing.size() >= maxQueue)
                return;
            if (message.size() > maxMessage)
                return;
            outgoing.push_back({ epoch.load(), std::move(message) });
            wake.notify_all();
        }
        std::optional<Credentials> readDescriptor()
        {
            const juce::File file { juce::String(descriptor) };
            if (! file.existsAsFile() || file.getSize() > 65536)
                return {};
            const auto value = juce::JSON::parse(file.loadFileAsString());
            Credentials data { string(value, "endpoint"),
                               string(value, "sessionId"),
                               string(value, "token"),
                               {},
                               {},
                               string(value, "project"),
                               0 };
            constexpr std::string_view prefix = "http://127.0.0.1:";
            if (! data.endpoint.starts_with(prefix) || data.session.empty() || data.session.size() > 128
                || data.token.size() != 64 || data.project.empty())
                return {};
            const auto port = data.endpoint.substr(prefix.size());
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
        std::optional<std::pair<int, juce::var>> request(const Credentials& data, const char* path, const char* method,
                                                         const std::string& body, std::size_t worker)
        {
            juce::URL url(juce::String(data.endpoint + path));
            if (! body.empty())
                url = url.withPOSTData(juce::String::fromUTF8(body.data(), static_cast<int>(body.size())));
            auto stream = std::make_shared<juce::WebInputStream>(url, false);
            stream->withCustomRequestCommand(method)
                .withConnectionTimeout(25000)
                .withNumRedirectsToFollow(0)
                .withExtraHeaders("Content-Type: application/json\r\nAuthorization: Bearer " + juce::String(data.token)
                                  + "\r\nX-Soundor-Session: " + juce::String(data.session)
                                  + "\r\nX-Soundor-Target: " + juce::String(data.target)
                                  + "\r\nX-Soundor-Target-Token: " + juce::String(data.targetToken) + "\r\n");
            {
                std::lock_guard lock(mutex);
                if (stopped.load())
                    return {};
                streams[worker] = stream;
            }
            bool valid = stream->connect(nullptr);
            std::string contents;
            std::array<char, 8192> buffer {};
            while (valid && ! stopped.load() && ! stream->isExhausted())
            {
                const int count = stream->read(buffer.data(), static_cast<int>(buffer.size()));
                if (count <= 0)
                    break;
                contents.append(buffer.data(), static_cast<std::size_t>(count));
                if (contents.size() > maxMessage)
                {
                    valid = false;
                    break;
                }
            }
            {
                std::lock_guard lock(mutex);
                if (streams[worker] == stream)
                    streams[worker].reset();
            }
            if (! valid || stopped.load() || stream->isError())
                return {};
            return std::pair { stream->getStatusCode(), juce::JSON::parse(juce::String::fromUTF8(
                                                            contents.data(), static_cast<int>(contents.size()))) };
        }
        void disconnect(unsigned expected)
        {
            std::shared_ptr<juce::WebInputStream> poll;
            {
                std::lock_guard lock(mutex);
                if (credentials.epoch != expected)
                    return;
                connected.store(false);
                credentials = {};
                incoming.clear();
                outgoing.clear();
                ++epoch;
                poll = streams[0];
            }
            if (poll)
                poll->cancel();
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
                            debug::Value(debug::Value::Object {
                                             { "version", 1 },
                                             { "sessionId", descriptorData->session },
                                             { "name", name },
                                             { "runtime", "JUCE Standalone" },
                                             { "generation", generation.load() },
                                             { "capabilities", debug::Value::Array { "inspector", "accessibility" } },
                                         })
                                .json();
                        const auto response = request(*descriptorData, "/runtime/register", "POST", registration, 0);
                        if (! response || response->first != 200)
                            error.store(response ? response->first : 503);
                        if (response && response->first == 200 && number(response->second, "version") == 1)
                        {
                            data = *descriptorData;
                            data.target = string(response->second, "targetId");
                            data.targetToken = string(response->second, "targetToken");
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
                const auto response = request(data, "/runtime/poll", "GET", {}, 0);
                if (! response || response->first != 200)
                {
                    error.store(response ? response->first : 503);
                    disconnect(data.epoch);
                    continue;
                }
                const auto commands = property(response->second, "commands");
                if (const auto* array = commands.getArray())
                {
                    for (const auto& value : *array)
                    {
                        debug::Command command;
                        command.id = string(value, "id");
                        const auto type = string(value, "type");
                        if (type == "cancel")
                        {
                            std::lock_guard lock(mutex);
                            std::erase_if(incoming,
                                          [&](const Incoming& item) { return item.command.id == command.id; });
                            continue;
                        }
                        command.method = type == "request" ? string(value, "method") : type;
                        command.targetGeneration = number(value, "generation");
                        const auto params = property(value, "params");
                        const auto node = property(params, "node");
                        command.node = nodeId(node);
                        command.generation = number(node, "generation");
                        command.enabled = static_cast<bool>(property(params, "enabled"));
                        const auto events = property(value, "events");
                        if (const auto* list = events.getArray())
                            for (const auto& item : *list)
                                command.events.insert(item.toString().toStdString());
                        std::lock_guard lock(mutex);
                        if (data.epoch == credentials.epoch && incoming.size() < maxQueue)
                            incoming.push_back({ data.epoch, std::move(command) });
                    }
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
                const auto response = request(data, "/runtime/messages", "POST", item.message, 1);
                if (! response || response->first == 401 || response->first == 410)
                    disconnect(data.epoch);
            }
        }
        void stop()
        {
            stopped.store(true);
            wake.notify_all();
            std::array<std::shared_ptr<juce::WebInputStream>, 2> active;
            {
                std::lock_guard lock(mutex);
                active = streams;
            }
            for (const auto& stream : active)
                if (stream)
                    stream->cancel();
            if (polling.joinable())
                polling.join();
            if (sending.joinable())
                sending.join();
        }
    };

    JuceDebugBridge::JuceDebugBridge(std::string descriptor, std::string name, js::LogSink output)
        : state(std::make_shared<State>(std::move(descriptor), std::move(name))),
          inspector(
              [this](std::string message)
              {
                  if (outgoing.size() < maxQueue && state->connected.load())
                      outgoing.emplace_back(observedEpoch, std::move(message));
              }),
          log(std::move(output))
    {
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
    JuceDebugBridge::~JuceDebugBridge()
    {
        state->stop();
    }
    void JuceDebugBridge::tick(RuntimeHost& host, unsigned generation)
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
                                     "designated session.");
        }
        const auto epoch = state->epoch.load();
        if (epoch != observedEpoch)
        {
            outgoing.clear();
            inspector.reset(host.surface());
            debug::Command subscriptions;
            subscriptions.method = "subscribe";
            inspector.execute(host, subscriptions);
            observedEpoch = epoch;
            if (state->connected.load())
                outgoing.emplace_back(
                    observedEpoch, debug::Value(debug::Value::Object {
                                                    { "type", "event" },
                                                    { "event", "Runtime.generationChanged" },
                                                    { "data", debug::Value::Object { { "generation", generation } } } })
                                       .json());
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
                    state->outgoing.push_back({ outgoing.front().first, std::move(outgoing.front().second) });
                    outgoing.pop_front();
                }
                state->wake.notify_all();
            }
        }
    }
    bool JuceDebugBridge::pointer(RuntimeHost& host, const ui::PointerInput& input)
    {
        if (! state->connected.load() || state->epoch.load() != observedEpoch)
            inspector.reset(host.surface());
        return inspector.pointer(host.surface(), input);
    }
    bool JuceDebugBridge::key(RuntimeHost& host, const ui::KeyInput& input)
    {
        if (! state->connected.load() || state->epoch.load() != observedEpoch)
            inspector.reset(host.surface());
        return inspector.key(host.surface(), input);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
#endif
