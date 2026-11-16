#include "Bindings.h"
#include "Internal.h"
#include "modules/Embedded.h"

#include <soundor/js/Streams.h>

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        // The streams of one install() in a context: what it read of each.
        struct StreamConnection
        {
            std::vector<std::shared_ptr<StreamCore>> streams;
            // By stream: the sequence number of the value the context has.
            std::vector<std::uint64_t> delivered;
            // Its update function among the context's retained values.
            const void* key = nullptr;
        };
    } // namespace detail

    namespace
    {
        template <typename T>
        jsi::Value streamValue(bind::ContextState& context, const detail::StreamCore& stream,
                               const detail::StreamCore::Slot& slot)
        {
            const auto* data = static_cast<const T*>(slot.data);
            if (! stream.buffer)
                return bind::write(context, data[0]);
            // The one copy, into storage JavaScript then owns: the slot is
            // the producer's again once a newer value is taken.
            return bind::writeBuffer(context, std::vector<T>(data, data + slot.length));
        }

        jsi::Value streamValue(bind::ContextState& context, const detail::StreamCore& stream)
        {
            const detail::StreamCore::Slot& slot = stream.front();
            using Element = detail::StreamElement;
            switch (stream.element)
            {
                case Element::Int8:
                    return streamValue<std::int8_t>(context, stream, slot);
                case Element::Uint8:
                    return streamValue<std::uint8_t>(context, stream, slot);
                case Element::Int16:
                    return streamValue<std::int16_t>(context, stream, slot);
                case Element::Uint16:
                    return streamValue<std::uint16_t>(context, stream, slot);
                case Element::Int32:
                    return streamValue<std::int32_t>(context, stream, slot);
                case Element::Uint32:
                    return streamValue<std::uint32_t>(context, stream, slot);
                case Element::Int64:
                    return streamValue<std::int64_t>(context, stream, slot);
                case Element::Uint64:
                    return streamValue<std::uint64_t>(context, stream, slot);
                case Element::Float32:
                    return streamValue<float>(context, stream, slot);
                case Element::Float64:
                    return streamValue<double>(context, stream, slot);
            }
            return jsi::Value::undefined();
        }

        // Gives the context the newest value of each stream of `connection`
        // it does not have, through `update`; `notify`: to its subscribers
        // too. How many it gave.
        std::size_t updateStreams(bind::ContextState& context, detail::StreamConnection& connection,
                                  const jsi::Function& update, bool notify)
        {
            std::size_t delivered = 0;
            for (std::size_t index = 0; index < connection.streams.size(); ++index)
            {
                if (context.halted())
                    return delivered;
                detail::StreamCore& stream = *connection.streams[index];
                stream.take();
                const std::uint64_t sequence = stream.front().sequence;
                if (sequence <= connection.delivered[index])
                    continue;
                connection.delivered[index] = sequence;
                const jsi::Value args[] = { jsi::Value(static_cast<double>(index)), streamValue(context, stream),
                                            jsi::Value(static_cast<double>(sequence)), jsi::Value(notify) };
                bind::call(context, update, jsi::Value::undefined(), args, "soundor:native stream update failed");
                ++delivered;
            }
            return delivered;
        }

        detail::StreamConnection* connectionOf(bind::ContextState& context, const void* key)
        {
            const auto found = std::ranges::find_if(context.streamConnections,
                                                    [key](const auto& connection) { return connection->key == key; });
            return found == context.streamConnections.end() ? nullptr : found->get();
        }
    } // namespace

    std::size_t deliverStreams(Context& context)
    {
        auto& state = stateOf(context);
        std::size_t delivered = 0;
        // A connection a subscriber's code adds (a module imported now) waits
        // for the next call.
        const std::vector<std::shared_ptr<detail::StreamConnection>> connections = state.streamConnections;
        for (const auto& connection : connections)
        {
            const jsi::Value* update = bind::retainedValue(state, connection->key);
            // Nobody imported soundor:native yet: its install takes the
            // latest values then.
            if (update == nullptr || ! bind::isFunction(state, *update))
                continue;
            const jsi::Function function = update->getObject(state.rt).getFunction(state.rt);
            delivered += updateStreams(state, *connection, function, true);
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
                std::string message = "soundor:native stream subscriber threw: " + error.toString();
                if (! error.stack.empty())
                    message += "\n" + error.stack;
                context.runtime->log(LogLevel::Error, message);
            }
            return jsi::Value::undefined();
        }
    } // namespace

    void connectStreams(Context& context, std::vector<std::shared_ptr<detail::StreamCore>> streams, const void* key)
    {
        auto& state = stateOf(context);
        if (state.nativeModules.find("soundor:internal/native-streams") == nullptr)
            registerNativeModule(context, "soundor:internal/native-streams",
                                 { {}, embedded::nativeStreamsModule.text(), embedded::nativeStreamsModule.bytecode });
        auto connection = std::make_shared<detail::StreamConnection>();
        connection->delivered.assign(streams.size(), 0);
        connection->streams = std::move(streams);
        connection->key = key;
        state.streamConnections.push_back(std::move(connection));
    }

    void installStreams(ContextState& context, jsi::Object& exports, std::span<const char* const> names,
                        const void* key)
    {
        jsi::Array list(context.rt, names.size());
        for (std::size_t index = 0; index < names.size(); ++index)
            list.setValueAtIndex(context.rt, index, jsi::String::createFromUtf8(context.rt, names[index]));
        const jsi::Object helper = context.require("soundor:internal/native-streams").getObject(context.rt);
        const jsi::Object created =
            helper.getPropertyAsFunction(context.rt, "createStreams")
                .call(context.rt, list, function(context, "reportError", 1, reportSubscriberError))
                .getObject(context.rt);
        exports.setProperty(context.rt, "streams", created.getProperty(context.rt, "streams"));
        jsi::Value update = created.getProperty(context.rt, "update");
        // The values published before the module was imported (before this
        // UI opened): its get() has the latest from the start.
        if (detail::StreamConnection* connection = connectionOf(context, key))
            updateStreams(context, *connection, update.getObject(context.rt).getFunction(context.rt), false);
        retainValue(context, key, std::move(update));
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
