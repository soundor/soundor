#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>

#include <cstddef>
#include <cstdint>
#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    class Context;

    namespace detail
    {
        struct EventHub;
    } // namespace detail

    // Discrete notifications from native code to the UI: what a plugin's
    // generated `native::Events` (soundor.config `native.events`) publishes,
    // and the `events` of `soundor:native` deliver.
    //
    // - publish() may be called from any thread but a realtime one (the audio
    //   callback): it takes a short lock, and its caller allocated the value.
    //   It never runs JavaScript and never waits for it.
    // - Every context connected to the source (one per UI runtime) receives
    //   each event published while it is connected, on its UI thread, when
    //   deliverEvents() runs (RuntimeHost::tick), in the order publish() was
    //   called. Events published before a context connected, or after it is
    //   gone (a closed editor, a reload), are not delivered to it.
    // - Bounded: a context holds at most `capacity` undelivered events. One
    //   published while it is full is dropped for that context, counted, and
    //   reported to the log when the context next delivers. With no context
    //   connected (no UI open), an event is dropped.
    //
    // A source outlives or not the contexts it is connected to: either may go
    // first.
    class EventSource
    {
    public:
        struct Options
        {
            // Undelivered events a context holds before it drops new ones.
            std::size_t capacity = 1024;
        };

        struct Statistics
        {
            // publish() calls.
            std::uint64_t published = 0;
            // Events a connected context dropped because it was full, and
            // events published while no context was connected.
            std::uint64_t dropped = 0;
        };

        EventSource();
        explicit EventSource(Options options);
        ~EventSource();

        EventSource(const EventSource&) = delete;
        EventSource& operator=(const EventSource&) = delete;
        EventSource(EventSource&&) = delete;
        EventSource& operator=(EventSource&&) = delete;

        [[nodiscard]] Statistics statistics() const noexcept;

        // The shared state contexts connect to (bindings).
        [[nodiscard]] const std::shared_ptr<detail::EventHub>& hub() const noexcept { return state; }

    protected:
        // Queues event number `event`, whose value `value` its binding reads
        // when it delivers it, for every connected context. Whether at least
        // one connected context took it.
        [[nodiscard]] bool publish(std::uint32_t event, const std::shared_ptr<const void>& value) const;

    private:
        std::shared_ptr<detail::EventHub> state;
    };

    // On the context's UI thread: delivers to its JavaScript the events its
    // sources published since the last call. Returns how many it delivered.
    std::size_t deliverEvents(Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
