#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS

    #include <soundor/json/Json.h>

    #include <charconv>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    namespace
    {
        // The protocol's form of a JSON value: numbers as doubles, objects by
        // name (the engine's JSON rejects duplicate members).
        Value convert(const json::Value& value)
        {
            switch (value.kind())
            {
                case json::Value::Kind::Null:
                    return {};
                case json::Value::Kind::Boolean:
                    return value.asBoolean();
                case json::Value::Kind::Number:
                    return value.asNumber();
                case json::Value::Kind::String:
                    return value.asString();
                case json::Value::Kind::Array:
                {
                    Value::Array out;
                    out.reserve(value.asArray().size());
                    for (const auto& item : value.asArray())
                        out.push_back(convert(item));
                    return out;
                }
                case json::Value::Kind::Object:
                {
                    Value::Object out;
                    for (const auto& [name, member] : value.asObject())
                        out.insert_or_assign(name, convert(member));
                    return out;
                }
            }
            return {};
        }

        const std::string* stringField(const Value::Object& object, const char* name)
        {
            const auto found = object.find(name);
            return found == object.end() ? nullptr : std::get_if<std::string>(&found->second.data);
        }
        std::optional<double> numberField(const Value::Object& object, const char* name)
        {
            const auto found = object.find(name);
            if (found == object.end())
                return {};
            if (const auto* number = std::get_if<double>(&found->second.data))
                return *number;
            return {};
        }
        unsigned positive(std::optional<double> value)
        {
            return value && *value >= 1 && *value <= 4294967295.0
                           && *value == static_cast<double>(static_cast<unsigned>(*value))
                       ? static_cast<unsigned>(*value)
                       : 0;
        }
    } // namespace

    std::optional<Value> Value::parse(std::string_view json)
    {
        try
        {
            return convert(soundor::json::parse(json));
        }
        catch (const soundor::json::Error&)
        {
            return {};
        }
    }

    std::optional<Command> Command::parse(const Value& value)
    {
        const auto* object = std::get_if<Value::Object>(&value.data);
        if (! object)
            return {};
        const auto* type = stringField(*object, "type");
        if (! type)
            return {};
        Command command;
        if (*type == "subscribe")
        {
            command.method = *type;
            const auto found = object->find("events");
            const auto* events = found == object->end() ? nullptr : std::get_if<Value::Array>(&found->second.data);
            if (! events)
                return {};
            for (const auto& event : *events)
                if (const auto* name = std::get_if<std::string>(&event.data))
                    command.events.insert(*name);
            return command;
        }
        if (*type == "clientGone")
        {
            const auto* client = stringField(*object, "client");
            if (! client || client->empty())
                return {};
            command.method = *type;
            command.client = *client;
            return command;
        }
        const auto* id = stringField(*object, "id");
        if (! id || id->empty())
            return {};
        command.id = *id;
        if (*type == "cancel")
        {
            command.method = *type;
            return command;
        }
        const auto* method = stringField(*object, "method");
        if (*type != "request" || ! method)
            return {};
        command.method = *method;
        if (const auto* client = stringField(*object, "client"))
            command.client = *client;
        command.targetGeneration = positive(numberField(*object, "generation"));
        if (command.targetGeneration == 0)
            return {};
        const auto params = object->find("params");
        if (params != object->end())
        {
            const auto* fields = std::get_if<Value::Object>(&params->second.data);
            if (! fields)
                return {};
            command.params = *fields;
        }
        if (const auto enabled = command.params.find("enabled"); enabled != command.params.end())
            if (const auto* flag = std::get_if<bool>(&enabled->second.data))
                command.enabled = *flag;
        if (const auto node = command.params.find("node"); node != command.params.end())
        {
            command.nodeRequested = true;
            if (const auto* ref = std::get_if<Value::Object>(&node->second.data))
            {
                command.generation = positive(numberField(*ref, "generation"));
                if (const auto* text = stringField(*ref, "id"))
                {
                    ui::NodeId parsed = ui::noNode;
                    const auto result = std::from_chars(text->data(), text->data() + text->size(), parsed);
                    if (result.ec == std::errc() && result.ptr == text->data() + text->size())
                        command.node = parsed;
                }
            }
        }
        return command;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
