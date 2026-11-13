#include "Bindings.h"
#include "Internal.h"
#include "modules/Embedded.h"

#include <soundor/js/Channels.h>

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        // The channels of one install() in a context: what it read of each.
        struct ChannelConnection
        {
            std::vector<std::shared_ptr<ChannelCore>> channels;
            // By channel: the sequence number of the value the context has.
            std::vector<std::uint64_t> delivered;
            // Its update function among the context's retained values.
            const void* key = nullptr;
        };
    } // namespace detail

    namespace
    {
        template <typename T>
        jsi::Value channelValue(bind::ContextState& context, const detail::ChannelCore& channel,
                                const detail::ChannelCore::Slot& slot)
        {
            const auto* data = static_cast<const T*>(slot.data);
            if (! channel.buffer)
                return bind::write(context, data[0]);
            // The one copy, into storage JavaScript then owns: the slot is
            // the producer's again once a newer value is taken.
            return bind::writeBuffer(context, std::vector<T>(data, data + slot.length));
        }

        jsi::Value channelValue(bind::ContextState& context, const detail::ChannelCore& channel)
        {
            const detail::ChannelCore::Slot& slot = channel.front();
            using Element = detail::ChannelElement;
            switch (channel.element)
            {
                case Element::Int8:
                    return channelValue<std::int8_t>(context, channel, slot);
                case Element::Uint8:
                    return channelValue<std::uint8_t>(context, channel, slot);
                case Element::Int16:
                    return channelValue<std::int16_t>(context, channel, slot);
                case Element::Uint16:
                    return channelValue<std::uint16_t>(context, channel, slot);
                case Element::Int32:
                    return channelValue<std::int32_t>(context, channel, slot);
                case Element::Uint32:
                    return channelValue<std::uint32_t>(context, channel, slot);
                case Element::Int64:
                    return channelValue<std::int64_t>(context, channel, slot);
                case Element::Uint64:
                    return channelValue<std::uint64_t>(context, channel, slot);
                case Element::Float32:
                    return channelValue<float>(context, channel, slot);
                case Element::Float64:
                    return channelValue<double>(context, channel, slot);
            }
            return jsi::Value::undefined();
        }

        // Gives the context the newest value of each channel of `connection`
        // it does not have, through `update`; `notify`: to its subscribers
        // too. How many it gave.
        std::size_t updateChannels(bind::ContextState& context, detail::ChannelConnection& connection,
                                   const jsi::Function& update, bool notify)
        {
            std::size_t delivered = 0;
            for (std::size_t index = 0; index < connection.channels.size(); ++index)
            {
                if (context.halted())
                    return delivered;
                detail::ChannelCore& channel = *connection.channels[index];
                channel.take();
                const std::uint64_t sequence = channel.front().sequence;
                if (sequence <= connection.delivered[index])
                    continue;
                connection.delivered[index] = sequence;
                const jsi::Value args[] = { jsi::Value(static_cast<double>(index)), channelValue(context, channel),
                                            jsi::Value(static_cast<double>(sequence)), jsi::Value(notify) };
                bind::call(context, update, jsi::Value::undefined(), args, "soundor:native channel update failed");
                ++delivered;
            }
            return delivered;
        }

        detail::ChannelConnection* connectionOf(bind::ContextState& context, const void* key)
        {
            const auto found = std::ranges::find_if(context.channelConnections,
                                                    [key](const auto& connection) { return connection->key == key; });
            return found == context.channelConnections.end() ? nullptr : found->get();
        }
    } // namespace

    std::size_t deliverChannels(Context& context)
    {
        auto& state = stateOf(context);
        std::size_t delivered = 0;
        // A connection a subscriber's code adds (a module imported now) waits
        // for the next call.
        const std::vector<std::shared_ptr<detail::ChannelConnection>> connections = state.channelConnections;
        for (const auto& connection : connections)
        {
            const jsi::Value* update = bind::retainedValue(state, connection->key);
            // Nobody imported soundor:native yet: its install takes the
            // latest values then.
            if (update == nullptr || ! bind::isFunction(state, *update))
                continue;
            const jsi::Function function = update->getObject(state.rt).getFunction(state.rt);
            delivered += updateChannels(state, *connection, function, true);
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
                std::string message = "soundor:native channel subscriber threw: " + error.toString();
                if (! error.stack.empty())
                    message += "\n" + error.stack;
                context.runtime->log(LogLevel::Error, message);
            }
            return jsi::Value::undefined();
        }
    } // namespace

    void connectChannels(Context& context, std::vector<std::shared_ptr<detail::ChannelCore>> channels, const void* key)
    {
        auto& state = stateOf(context);
        if (state.nativeModules.find("soundor:internal/native-channels") == nullptr)
            registerNativeModule(
                context, "soundor:internal/native-channels",
                { {}, embedded::nativeChannelsModule.text(), embedded::nativeChannelsModule.bytecode });
        auto connection = std::make_shared<detail::ChannelConnection>();
        connection->delivered.assign(channels.size(), 0);
        connection->channels = std::move(channels);
        connection->key = key;
        state.channelConnections.push_back(std::move(connection));
    }

    void installChannels(ContextState& context, jsi::Object& exports, std::span<const char* const> names,
                         const void* key)
    {
        jsi::Array list(context.rt, names.size());
        for (std::size_t index = 0; index < names.size(); ++index)
            list.setValueAtIndex(context.rt, index, jsi::String::createFromUtf8(context.rt, names[index]));
        const jsi::Object helper = context.require("soundor:internal/native-channels").getObject(context.rt);
        const jsi::Object created =
            helper.getPropertyAsFunction(context.rt, "createChannels")
                .call(context.rt, list, function(context, "reportError", 1, reportSubscriberError))
                .getObject(context.rt);
        exports.setProperty(context.rt, "channels", created.getProperty(context.rt, "channels"));
        jsi::Value update = created.getProperty(context.rt, "update");
        // The values published before the module was imported (before this
        // UI opened): its get() has the latest from the start.
        if (detail::ChannelConnection* connection = connectionOf(context, key))
            updateChannels(context, *connection, update.getObject(context.rt).getFunction(context.rt), false);
        retainValue(context, key, std::move(update));
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
