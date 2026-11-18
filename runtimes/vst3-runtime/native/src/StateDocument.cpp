#include "StateDocument.h"

#include <cmath>
#include <stdexcept>

namespace soundor::vst3
{
    std::string writeStateDocument(const Plugin& plugin, const StateSchema& schema, std::span<const double> parameters,
                                   const std::map<std::string, std::string>& state)
    {
        auto values = json::Value::object();
        for (std::size_t i = 0; i < plugin.parameters.size() && i < parameters.size(); ++i)
        {
            const auto& info = plugin.parameters[i].info;
            const double plain = parameters[i];
            switch (info.type)
            {
            case parameters::Type::Boolean:
                values.set(info.id, json::Value::boolean(plain >= 0.5));
                break;
            case parameters::Type::Choice:
            {
                const auto index = static_cast<std::size_t>(std::clamp<long long>(
                    std::llround(plain), 0, static_cast<long long>(info.choices.size()) - 1));
                values.set(info.id, json::Value::string(info.choices.empty() ? std::string() : info.choices[index].value));
                break;
            }
            default:
                values.set(info.id, json::Value::number(std::isfinite(plain) ? plain : info.defaultValue));
            }
        }
        auto document = json::Value::object();
        document.set("version", json::Value::integer(1));
        document.set("parameters", std::move(values));
        document.set("state", schema.write(state));
        auto text = json::write(document);
        if (text.size() > maxSnapshotBytes)
            throw std::length_error("Soundor snapshot exceeds 8 MiB");
        return text;
    }

    StateDocument defaultStateDocument(const Plugin& plugin, const StateSchema& schema)
    {
        StateDocument out;
        for (const auto& parameter : plugin.parameters)
            out.parameters.push_back(parameter.info.defaultValue);
        out.state = schema.defaults();
        return out;
    }

    StateDocument readStateDocument(const Plugin& plugin, const StateSchema& schema, std::string_view text)
    {
        if (text.empty() || text.size() > maxSnapshotBytes)
            throw std::invalid_argument("invalid Soundor snapshot size");
        json::Value document;
        try
        {
            document = json::parse(text);
        }
        catch (const json::Error& error)
        {
            throw std::invalid_argument(std::string("invalid Soundor snapshot: ") + error.what());
        }
        if (! document.isObject())
            throw std::invalid_argument("invalid Soundor snapshot: expected an object");
        const auto* version = document.find("version");
        if (version == nullptr || version->asInt64() != 1)
            throw std::invalid_argument("unsupported Soundor snapshot version");
        auto out = defaultStateDocument(plugin, schema);
        const auto* saved = document.find("parameters");
        if (saved != nullptr && ! saved->isObject())
            throw std::invalid_argument("parameters: expected an object");
        for (std::size_t i = 0; saved != nullptr && i < plugin.parameters.size(); ++i)
        {
            const auto& info = plugin.parameters[i].info;
            const auto* value = saved->find(info.id);
            if (value == nullptr)
                continue;
            const auto where = "parameters." + info.id;
            switch (info.type)
            {
            case parameters::Type::Boolean:
                if (! value->isBoolean())
                    throw std::invalid_argument(where + ": expected boolean");
                out.parameters[i] = value->asBoolean() ? 1.0 : 0.0;
                break;
            case parameters::Type::Choice:
            {
                if (! value->isString())
                    throw std::invalid_argument(where + ": expected choice");
                bool found = false;
                for (std::size_t option = 0; option < info.choices.size(); ++option)
                    if (info.choices[option].value == value->asString())
                    {
                        out.parameters[i] = static_cast<double>(option);
                        found = true;
                    }
                if (! found)
                    throw std::invalid_argument(where + ": invalid choice");
                break;
            }
            default:
            {
                if (! value->isNumber())
                    throw std::invalid_argument(where + ": expected number");
                const double number = value->asNumber();
                const bool integral = info.type != parameters::Type::Float32;
                if (! std::isfinite(number) || number < info.min || number > info.max
                    || (integral && std::trunc(number) != number))
                    throw std::invalid_argument(where + ": invalid number");
                out.parameters[i] = number;
            }
            }
        }
        out.state = schema.read(document.find("state"));
        return out;
    }
} // namespace soundor::vst3
