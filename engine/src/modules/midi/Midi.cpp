#include "js/Bindings.h"
#include "modules/Embedded.h"

#include <soundor/midi/Midi.h>

#include <array>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::midi
{
    namespace
    {
        namespace bind = js::bind;
        const char bindingKey = 0, eventsKey = 0;
        struct Packet
        {
            std::uint64_t sequence = 0, total = 0, dropped = 0;
            bool reset = false;
            std::vector<SoundorMidiEvent> events;
        };
        struct Binding
        {
            std::shared_ptr<Host> host;
            bool observed = false, sent = false;
            std::uint64_t first = 0, total = 0, lost = 0;
            ~Binding()
            {
                if (observed)
                    host->observe(false);
                if (sent)
                    host->recover();
            }
        };
        Binding& binding(bind::ContextState& ctx)
        {
            return *bind::contextData<Binding>(ctx, &bindingKey);
        }
        int integer(bind::ContextState& ctx, const jsi::Object& object, const char* key, int min, int max)
        {
            const auto value = object.getProperty(ctx.rt, key);
            if (! value.isNumber() || ! std::isfinite(value.getNumber())
                || std::floor(value.getNumber()) != value.getNumber() || value.getNumber() < min
                || value.getNumber() > max)
                bind::throwRangeError(ctx, std::string("MIDI: invalid ") + key);
            return static_cast<int>(value.getNumber());
        }
        SoundorMidiEvent readMessage(bind::ContextState& ctx, const jsi::Value& value)
        {
            if (! value.isObject())
                bind::throwTypeError(ctx, "MIDI: expected message");
            const auto object = value.getObject(ctx.rt);
            const auto typeValue = object.getProperty(ctx.rt, "type");
            if (! typeValue.isString())
                bind::throwTypeError(ctx, "MIDI: expected message type");
            const auto type = typeValue.getString(ctx.rt).utf8(ctx.rt);
            const auto channel = integer(ctx, object, "channel", 1, 16) - 1;
            auto data = [&](const char* key) { return integer(ctx, object, key, 0, 127); };
            int kind = 0, a = 0, b = 0;
            if (type == "noteOn" || type == "noteOff")
            {
                kind = type == "noteOn" ? 9 : 8;
                a = data("note");
                b = data("velocity");
            }
            else if (type == "controlChange")
            {
                kind = 11;
                a = data("controller");
                b = data("value");
            }
            else if (type == "polyphonicAftertouch")
            {
                kind = 10;
                a = data("note");
                b = data("pressure");
            }
            else if (type == "programChange")
            {
                kind = 12;
                a = data("program");
            }
            else if (type == "channelPressure")
            {
                kind = 13;
                a = data("pressure");
            }
            else if (type == "pitchBend")
            {
                kind = 14;
                const auto bend = integer(ctx, object, "value", 0, 16383);
                a = bend & 127;
                b = bend >> 7;
            }
            else
                bind::throwTypeError(ctx, "MIDI: unsupported message type");
            return { 0,
                     { static_cast<std::uint8_t>((kind << 4) | channel), static_cast<std::uint8_t>(a),
                       static_cast<std::uint8_t>(b) },
                     2 };
        }
        jsi::Value message(bind::ContextState& ctx, const SoundorMidiEvent& event)
        {
            bind::ObjectBuilder object(ctx);
            const auto kind = event.bytes[0] >> 4;
            const char* names[] { "noteOff",       "noteOn",        "polyphonicAftertouch",
                                  "controlChange", "programChange", "channelPressure",
                                  "pitchBend" };
            object.set("type", bind::write(ctx, std::string(names[kind - 8])));
            object.set("channel", jsi::Value((event.bytes[0] & 15) + 1));
            const auto a = event.bytes[1], b = event.bytes[2];
            if (kind == 8 || kind == 9)
            {
                object.set("note", jsi::Value(a));
                object.set("velocity", jsi::Value(b));
            }
            else if (kind == 10)
            {
                object.set("note", jsi::Value(a));
                object.set("pressure", jsi::Value(b));
            }
            else if (kind == 11)
            {
                object.set("controller", jsi::Value(a));
                object.set("value", jsi::Value(b));
            }
            else if (kind == 12)
                object.set("program", jsi::Value(a));
            else if (kind == 13)
                object.set("pressure", jsi::Value(a));
            else
                object.set("value", jsi::Value(a | (b << 7)));
            return object.release();
        }
        void deliver(bind::ContextState& ctx, std::uint32_t, const void* data)
        {
            const auto& packet = *static_cast<const Packet*>(data);
            auto& view = binding(ctx);
            if (! view.observed || packet.sequence < view.first)
                return;
            const auto missed = packet.total - view.total - packet.events.size();
            view.lost += missed;
            view.total = packet.total;
            const bool reset = packet.reset || missed > 0;
            bind::ObjectBuilder batch(ctx);
            batch.set("dropped", jsi::Value(static_cast<double>(packet.dropped + view.lost)));
            batch.set("reset", jsi::Value(reset));
            jsi::Array events(ctx.rt, reset ? 0 : packet.events.size());
            if (! reset)
                for (std::size_t i = 0; i < packet.events.size(); ++i)
                {
                    const auto& event = packet.events[i];
                    bind::ObjectBuilder item(ctx);
                    item.set("message", message(ctx, event));
                    item.set("sampleOffset", jsi::Value(static_cast<double>(event.sampleOffset)));
                    if (event.source != 0)
                        item.set("source", bind::write(ctx, std::string(event.source == 1   ? "host"
                                                                        : event.source == 2 ? "ui"
                                                                                            : "controller")));
                    events.setValueAtIndex(ctx.rt, i, item.release());
                }
            batch.set("events", std::move(events));
            bind::dispatchEvent(ctx, &eventsKey, 0, batch.release());
        }
    } // namespace
    struct Host::State
    {
        Functions functions;
        void* port = nullptr;
        std::size_t observers = 0;
        std::uint64_t sequence = 0, total = 0;
    };
    Host::Host(void* processor, Functions functions) : EventSource(Options { 8 }), state(std::make_unique<State>())
    {
        state->functions = functions;
        if (processor != nullptr && functions.create != nullptr)
            state->port = functions.create(processor);
    }
    Host::~Host()
    {
        if (state->port != nullptr)
            state->functions.destroy(state->port);
    }
    std::int32_t Host::send(SoundorMidiEvent event)
    {
        return state->port == nullptr ? 2 : state->functions.send(state->port, event);
    }
    void Host::recover()
    {
        if (state->port != nullptr)
            state->functions.recover(state->port);
    }
    void Host::active(bool active)
    {
        if (state->port != nullptr)
            state->functions.active(state->port, active);
    }
    bool Host::observe(bool enabled) noexcept
    {
        if (enabled)
        {
            if (state->observers == 0 && state->port != nullptr && ! state->functions.observe(state->port, true))
                return false;
            ++state->observers;
        }
        else if (state->observers > 0)
        {
            --state->observers;
            if (state->observers == 0 && state->port != nullptr)
                state->functions.observe(state->port, false);
        }
        return true;
    }
    std::uint64_t Host::sequence() const noexcept
    {
        return state->sequence;
    }
    std::uint64_t Host::total() const noexcept
    {
        return state->total;
    }
    void Host::pump()
    {
        if (state->observers == 0 || state->port == nullptr)
            return;
        std::array<SoundorMidiEvent, capacity> records {};
        SoundorMidiStatus status;
        const auto count = state->functions.read(state->port, records.data(), capacity, &status);
        if (count > capacity)
            throw std::runtime_error("Invalid MIDI observation batch size");
        auto packet = std::make_shared<Packet>();
        packet->sequence = ++state->sequence;
        state->total += count;
        packet->total = state->total;
        packet->dropped = status.dropped;
        packet->reset = status.reset != 0;
        packet->events.assign(records.begin(), records.begin() + count);
        static_cast<void>(publish(0, packet));
    }
    void install(js::Context& context, std::shared_ptr<Host> host)
    {
        auto instance = std::make_shared<Binding>();
        instance->host = std::move(host);
        bind::connectEvents(context, *instance->host, deliver);
        bind::setContextData(context, &bindingKey, std::move(instance));
        js::registerNativeModule(
            context, "soundor:internal/midi",
            { [](bind::ContextState& ctx, jsi::Object& exports)
              {
                  constexpr const char* names[] { "batch" };
                  bind::installEvents(ctx, exports, names, &eventsKey);
                  exports.setProperty(ctx.rt, "send",
                                      bind::closure(ctx, "send", 1,
                                                    [](auto& c, const auto&, const auto* args, auto count)
                                                    {
                                                        return bind::invoke(
                                                            c, "midi.send",
                                                            [&]
                                                            {
                                                                binding(c).sent = true;
                                                                const auto result = binding(c).host->send(
                                                                    readMessage(c, bind::argument(args, count, 0)));
                                                                return bind::write(c, std::string(result == 0 ? "sent"
                                                                                                  : result == 1
                                                                                                      ? "full"
                                                                                                      : "inactive"));
                                                            });
                                                    }));
                  exports.setProperty(
                      ctx.rt, "observe",
                      bind::closure(ctx, "observe", 1,
                                    [](auto& c, const auto&, const auto* args, auto count)
                                    {
                                        return bind::invoke(
                                            c, "midi.subscribe",
                                            [&]
                                            {
                                                auto& view = binding(c);
                                                const bool enabled = bind::argument(args, count, 0).getBool();
                                                if (enabled != view.observed)
                                                {

                                                    if (! view.host->observe(enabled))
                                                        throw std::runtime_error(
                                                            "MIDI observer already owned by another endpoint");
                                                    view.observed = enabled;
                                                    if (enabled)
                                                    {
                                                        view.first = view.host->sequence() + 1;
                                                        view.total = view.host->total();
                                                        view.lost = 0;
                                                    }
                                                }
                                                return jsi::Value::undefined();
                                            });
                                    }));
              },
              {},
              {} });
        js::registerNativeModule(context, "soundor:midi",
                                 { {}, embedded::midiModule.text(), embedded::midiModule.bytecode });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::midi
