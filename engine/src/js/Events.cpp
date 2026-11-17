#include "Bindings.h"
#include "Internal.h"
#include "modules/Embedded.h"

#include <soundor/js/Events.h>

#include <algorithm>
#include <atomic>
#include <deque>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        struct QueuedEvent
        {
            std::uint32_t event = 0;
            std::shared_ptr<const void> value;
        };

        // A context's undelivered events. Guarded by its hub's mutex.
        struct EventSink
        {
            std::deque<QueuedEvent> queue;
            std::uint64_t overflowed = 0;
        };

        struct EventHub
        {
            explicit EventHub(std::size_t limit) : capacity(std::max<std::size_t>(limit, 1)) {}

            const std::size_t capacity;
            std::mutex mutex;
            std::vector<EventSink*> sinks;
            std::atomic<std::uint64_t> published { 0 };
            std::atomic<std::uint64_t> dropped { 0 };
        };

        // A source connected to a context: what the context owns, its sink
        // registered with the hub until the context goes.
        struct EventConnection
        {
            EventConnection(std::shared_ptr<EventHub> source, bind::DeliverEvent deliverer)
                : hub(std::move(source)), deliver(deliverer)
            {
                const std::lock_guard lock(hub->mutex);
                hub->sinks.push_back(&sink);
            }

            ~EventConnection()
            {
                const std::lock_guard lock(hub->mutex);
                std::erase(hub->sinks, &sink);
            }

            EventConnection(const EventConnection&) = delete;
            EventConnection& operator=(const EventConnection&) = delete;
            EventConnection(EventConnection&&) = delete;
            EventConnection& operator=(EventConnection&&) = delete;

            std::shared_ptr<EventHub> hub;
            bind::DeliverEvent deliver;
            EventSink sink;
        };
    } // namespace detail

    EventSource::EventSource() : EventSource(Options {}) {}

    EventSource::EventSource(Options options) : state(std::make_shared<detail::EventHub>(options.capacity)) {}

    EventSource::~EventSource() = default;

    EventSource::Statistics EventSource::statistics() const noexcept
    {
        return { state->published.load(std::memory_order_relaxed), state->dropped.load(std::memory_order_relaxed) };
    }

    bool EventSource::publish(std::uint32_t event, const std::shared_ptr<const void>& value) const
    {
        state->published.fetch_add(1, std::memory_order_relaxed);
        std::uint64_t dropped = 0;
        bool taken = false;
        {
            const std::lock_guard lock(state->mutex);
            if (state->sinks.empty())
                dropped = 1;
            for (detail::EventSink* sink : state->sinks)
            {
                if (sink->queue.size() >= state->capacity)
                {
                    ++sink->overflowed;
                    ++dropped;
                    continue;
                }
                sink->queue.push_back({ event, value });
                taken = true;
            }
        }
        if (dropped > 0)
            state->dropped.fetch_add(dropped, std::memory_order_relaxed);
        return taken;
    }

    std::size_t deliverEvents(Context& context)
    {
        auto& state = stateOf(context);
        std::size_t delivered = 0;
        // A connection a subscriber's code adds (a module imported now) waits
        // for the next call.
        const std::vector<std::shared_ptr<detail::EventConnection>> connections = state.eventConnections;
        for (const auto& connection : connections)
        {
            std::deque<detail::QueuedEvent> events;
            std::uint64_t overflowed = 0;
            {
                const std::lock_guard lock(connection->hub->mutex);
                events.swap(connection->sink.queue);
                overflowed = std::exchange(connection->sink.overflowed, 0);
            }
            if (overflowed > 0)
                state.runtime->log(LogLevel::Warn,
                                   "soundor:native: " + std::to_string(overflowed)
                                       + " events were dropped: the UI did not take them in time (it holds "
                                       + std::to_string(connection->hub->capacity) + ")");
            for (const detail::QueuedEvent& queued : events)
            {
                if (state.halted())
                    return delivered;
                try
                {
                    connection->deliver(state, queued.event, queued.value.get());
                }
                catch (...)
                {
                    const Error error = detail::caughtError(state);
                    state.runtime->log(LogLevel::Error, "soundor:native event delivery failed: " + error.toString());
                }
                ++delivered;
            }
        }
        return delivered;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    namespace
    {
        jsi::Value reportSubscriberError(ContextState& context, const jsi::Value&, const jsi::Value* args,
                                         std::size_t count)
        {
            if (count > 0)
            {
                const Error error = detail::toError(context, args[0]);
                std::string message = "soundor:native event subscriber threw: " + error.toString();
                if (! error.stack.empty())
                    message += "\n" + error.stack;
                context.runtime->log(LogLevel::Error, message);
            }
            return jsi::Value::undefined();
        }
    } // namespace

    void connectEvents(Context& context, const EventSource& source, DeliverEvent deliver)
    {
        auto& state = stateOf(context);
        if (state.nativeModules.find("soundor:internal/native-events") == nullptr)
            registerNativeModule(context, "soundor:internal/native-events",
                                 { {}, embedded::nativeEventsModule.text(), embedded::nativeEventsModule.bytecode });
        state.eventConnections.push_back(std::make_shared<detail::EventConnection>(source.hub(), deliver));
    }

    void installEvents(ContextState& context, jsi::Object& exports, std::span<const char* const> names, const void* key)
    {
        jsi::Array list(context.rt, names.size());
        for (std::size_t index = 0; index < names.size(); ++index)
            list.setValueAtIndex(context.rt, index, jsi::String::createFromUtf8(context.rt, names[index]));
        const jsi::Object helper = context.require("soundor:internal/native-events").getObject(context.rt);
        const jsi::Object created =
            helper.getPropertyAsFunction(context.rt, "createEvents")
                .call(context.rt, list, function(context, "reportError", 1, reportSubscriberError))
                .getObject(context.rt);
        exports.setProperty(context.rt, "events", created.getProperty(context.rt, "events"));
        retainValue(context, key, created.getProperty(context.rt, "dispatch"));
    }

    void dispatchEvent(ContextState& context, const void* key, std::uint32_t event, const jsi::Value& value)
    {
        const jsi::Value* dispatcher = retainedValue(context, key);
        // Nobody imported soundor:native yet: nobody subscribed.
        if (dispatcher == nullptr || ! isFunction(context, *dispatcher))
            return;
        const jsi::Function function = dispatcher->getObject(context.rt).getFunction(context.rt);
        const jsi::Value args[] = { jsi::Value(static_cast<double>(event)), jsi::Value(context.rt, value) };
        call(context, function, jsi::Value::undefined(), args, "soundor:native event dispatch failed");
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
