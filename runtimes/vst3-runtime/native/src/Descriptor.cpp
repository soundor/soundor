#include "Descriptor.h"

#include "Log.h"
#include "State.h"

#include <soundor/vst3/PluginAbi.h>

#include <algorithm>
#include <cmath>
#include <mutex>

namespace soundor::vst3
{
    namespace
    {
        using expression::Base;
        using expression::Expression;
        using expression::Value;

        parameters::Type parameterType(const std::string& name)
        {
            static constexpr std::pair<std::string_view, parameters::Type> names[] = {
                { "int8", parameters::Type::Int8 },       { "uint8", parameters::Type::Uint8 },
                { "int16", parameters::Type::Int16 },     { "uint16", parameters::Type::Uint16 },
                { "int32", parameters::Type::Int32 },     { "uint32", parameters::Type::Uint32 },
                { "float32", parameters::Type::Float32 }, { "boolean", parameters::Type::Boolean },
                { "choice", parameters::Type::Choice },
            };
            for (const auto& [text, type] : names)
                if (text == name)
                    return type;
            throw json::Error("unknown parameter type \"" + name + "\"");
        }

        parameters::Access parameterAccess(const std::string& name)
        {
            if (name == "automatable")
                return parameters::Access::Automatable;
            if (name == "manual")
                return parameters::Access::Manual;
            if (name == "readOnly")
                return parameters::Access::ReadOnly;
            throw json::Error("unknown parameter access \"" + name + "\"");
        }

        int integer(const json::Value& value, std::string_view name, int fallback = 0)
        {
            const auto* member = value.find(name);
            if (member == nullptr || member->isNull())
                return fallback;
            const auto parsed = member->asInt64();
            if (! parsed || *parsed < INT32_MIN || *parsed > INT32_MAX)
                throw json::Error(std::string(name) + " is not an integer");
            return static_cast<int>(*parsed);
        }

        std::vector<int> channelCounts(const json::Value& value)
        {
            std::vector<int> out;
            for (const auto& count : value.asArray())
            {
                const auto parsed = count.asInt64();
                if (! parsed || *parsed < 0 || *parsed > 64)
                    throw json::Error("a channel count is 0 to 64");
                out.push_back(static_cast<int>(*parsed));
            }
            if (out.empty())
                throw json::Error("a bus of a layout offers at least one channel count");
            return out;
        }

        ParameterBehavior behavior(const json::Value& semantics)
        {
            ParameterBehavior out;
            const auto valueType = expression::parseType(semantics.at("valueType").asString());
            if (valueType.nullable || valueType.base == Base::String)
                throw json::Error("a parameter's value type is numeric");
            out.valueType = valueType.base;
            const expression::Type float64 { Base::Float64, false };
            const expression::Type string { Base::String, false };
            out.toValue = Expression::compile(semantics.at("toValue"), { { "normalized", float64 } });
            out.toNormalized = Expression::compile(semantics.at("toNormalized"), { { "value", valueType } });
            out.constrain = Expression::compile(semantics.at("constrain"), { { "value", float64 } });
            out.format = Expression::compile(semantics.at("format"), { { "value", valueType } });
            out.parse = Expression::compile(semantics.at("parse"), { { "text", string } });
            if (! (out.toValue.type() == valueType) || out.toNormalized.type().base != Base::Float64
                || ! (out.constrain.type() == valueType) || out.format.type().base != Base::String
                || out.parse.type().base != valueType.base || ! out.parse.type().nullable)
                throw json::Error("a parameter's expressions have the wrong types");
            return out;
        }

        Parameter parameter(const json::Value& value)
        {
            Parameter out;
            auto& info = out.info;
            info.id = value.at("id").asString();
            try
            {
                info.label = value.stringOr("label", info.id);
                info.type = parameterType(value.at("type").asString());
                info.access = parameterAccess(value.stringOr("access", "automatable"));
                info.min = value.at("min").asNumber();
                info.max = value.at("max").asNumber();
                info.defaultValue = value.at("default").asNumber();
                info.step = value.numberOr("step");
                info.unit = value.stringOr("unit");
                if (const auto* choices = value.find("choices"))
                    for (const auto& choice : choices->asArray())
                        info.choices.push_back({ choice.at("value").asString(), choice.stringOr("label") });
                info.group = value.stringOr("group");
                info.role = value.stringOr("role");
                const auto vstId = value.at("vstId").asUint64();
                if (! vstId || *vstId >= 0x80000000ULL)
                    throw json::Error("vstId is a 31-bit integer");
                out.vstId = static_cast<std::uint32_t>(*vstId);
                out.stepCount = integer(value, "stepCount");
                out.behavior = behavior(value.at("semantics"));
            }
            catch (const json::Error& error)
            {
                throw json::Error("parameter \"" + info.id + "\": " + error.what());
            }
            return out;
        }

        EditorConfig editor(const json::Value& value)
        {
            EditorConfig out;
            out.width = std::max(1, integer(value, "width", 800));
            out.height = std::max(1, integer(value, "height", 600));
            out.minWidth = integer(value, "minWidth");
            out.minHeight = integer(value, "minHeight");
            out.maxWidth = integer(value, "maxWidth");
            out.maxHeight = integer(value, "maxHeight");
            out.resizable = value.booleanOr("resizable");
            out.scale = value.booleanOr("scale");
            out.keepAspectRatio = value.booleanOr("keepAspectRatio");
            out.cover = value.booleanOr("cover");
            if (const auto* background = value.find("background"); background != nullptr && background->isNumber())
                out.background = static_cast<std::uint32_t>(background->asUint64().value_or(0xFF000000));
            return out;
        }
    } // namespace

    ClassId parseClassId(std::string_view hex)
    {
        if (hex.size() != 32)
            throw json::Error("a class id is 32 hexadecimal digits");
        ClassId out {};
        for (std::size_t i = 0; i < 16; ++i)
        {
            unsigned byte = 0;
            for (std::size_t k = 0; k < 2; ++k)
            {
                const char c = hex[i * 2 + k];
                unsigned digit = 0;
                if (c >= '0' && c <= '9')
                    digit = static_cast<unsigned>(c - '0');
                else if (c >= 'a' && c <= 'f')
                    digit = static_cast<unsigned>(c - 'a' + 10);
                else if (c >= 'A' && c <= 'F')
                    digit = static_cast<unsigned>(c - 'A' + 10);
                else
                    throw json::Error("a class id is 32 hexadecimal digits");
                byte = byte * 16 + digit;
            }
            out[i] = static_cast<std::uint8_t>(byte);
        }
        return out;
    }

    std::unique_ptr<Plugin> parseDescriptor(std::string_view text)
    {
        const auto root = json::parse(text);
        const auto format = root.at("format").asInt64();
        if (! format || *format != descriptorFormat)
            throw json::Error("descriptor format " + root.at("format").numberText() + " (this adapter reads "
                              + std::to_string(descriptorFormat) + "): rebuild the plugin with a matching runtime");
        auto out = std::make_unique<Plugin>();
        const auto& identity = root.at("plugin");
        out->id = identity.at("id").asString();
        out->name = identity.at("name").asString();
        out->vendor = identity.stringOr("vendor");
        out->url = identity.stringOr("url");
        out->email = identity.stringOr("email");
        out->version = identity.stringOr("version", "0.1.0");
        out->copyright = identity.stringOr("copyright");
        out->subcategories = identity.stringOr("subcategories", "Fx");
        out->processorCid = parseClassId(identity.at("processorCid").asString());
        out->controllerCid = parseClassId(identity.at("controllerCid").asString());

        const auto& audio = root.at("audio");
        for (const auto& [direction, list] :
             { std::pair { "inputs", &out->inputs }, std::pair { "outputs", &out->outputs } })
            for (const auto& bus : audio.at(direction).asArray())
                list->push_back(
                    { bus.at("name").asString(), integer(bus, "initialChannels"), integer(bus, "enabledChannels") });
        for (const auto& layout : audio.at("layouts").asArray())
        {
            Layout parsed { layout.stringOr("name"), {}, {} };
            for (const auto& bus : layout.at("inputs").asArray())
                parsed.inputs.push_back(channelCounts(bus));
            for (const auto& bus : layout.at("outputs").asArray())
                parsed.outputs.push_back(channelCounts(bus));
            if (parsed.inputs.size() != out->inputs.size() || parsed.outputs.size() != out->outputs.size())
                throw json::Error("layout \"" + parsed.name + "\" does not give every bus its channels");
            out->layouts.push_back(std::move(parsed));
        }
        out->latency = static_cast<std::uint32_t>(std::max(0, integer(audio, "latency")));
        out->tailSeconds = audio.numberOr("tailSeconds");

        const auto& midi = root.at("midi");
        out->midiInput = midi.booleanOr("input");
        out->midiOutput = midi.booleanOr("output");

        out->editor = editor(root.at("editor"));
        if (const auto* runtime = root.find("runtime"))
            out->timeLimit = std::max(0, integer(*runtime, "timeLimit", 5000));

        for (const auto& value : root.at("parameters").asArray())
        {
            auto parsed = parameter(value);
            if (out->byVstId.contains(parsed.vstId))
                throw json::Error("two parameters share the VST3 id " + std::to_string(parsed.vstId));
            out->byVstId.emplace(parsed.vstId, out->parameters.size());
            out->infos.push_back(parsed.info);
            out->parameters.push_back(std::move(parsed));
        }
        for (const auto& group : root.at("groups").asArray())
            out->groups.push_back({ group.at("id").asString(), group.stringOr("label"), integer(group, "unit") });
        for (auto& parameter : out->parameters)
            for (const auto& group : out->groups)
                if (group.id == parameter.info.group)
                    parameter.unit = group.unit;

        const auto& state = root.at("state");
        for (const auto& field : state.at("fields").asArray())
        {
            StateField parsed;
            parsed.name = field.at("name").asString();
            parsed.type = field.at("type");
            parsed.defaultJson = field.at("default").asString();
            if (const auto* maxLength = field.find("maxLength"); maxLength != nullptr && ! maxLength->isNull())
                parsed.maxLength = static_cast<std::size_t>(maxLength->asUint64().value_or(0));
            parsed.audio = field.booleanOr("audio");
            out->state.push_back(std::move(parsed));
        }
        out->stateTypes = state.at("types");
        const auto& audioState = state.at("audio");
        out->audioStateSize = static_cast<std::size_t>(audioState.at("size").asUint64().value_or(0));
        for (const auto& field : audioState.at("fields").asArray())
            out->audioState.push_back({ field.at("name").asString(), field.at("kind").asString() == "array",
                                        field.at("element").asString(),
                                        static_cast<std::size_t>(field.at("offset").asUint64().value_or(0)),
                                        static_cast<std::size_t>(field.numberOr("dataOffset")),
                                        static_cast<std::size_t>(field.numberOr("maxLength")) });

        for (const auto& preset : root.at("presets").asArray())
        {
            Preset parsed { preset.at("id").asString(), preset.stringOr("name"), {}, {} };
            for (const auto& [id, value] : preset.at("parameters").asObject())
            {
                const auto index = out->indexOf(id);
                if (! index)
                    throw json::Error("preset \"" + parsed.id + "\" sets an unknown parameter \"" + id + "\"");
                parsed.parameters.emplace_back(*index, value.asNumber());
            }
            for (const auto& [field, value] : preset.at("state").asObject())
                parsed.state.emplace(field, value.asString());
            out->presets.push_back(std::move(parsed));
        }

        for (const auto& stream : root.at("streams").asArray())
            out->streams.push_back({ stream.at("name").asString(), stream.at("kind").asString() == "buffer",
                                     stream.at("element").asString(),
                                     static_cast<std::size_t>(stream.numberOr("maxLength")) });

        for (const auto& event : root.at("events").asArray())
            out->events.push_back(event.asString());

        const auto& contract = root.at("contract");
        out->contract.parameters = static_cast<std::uint32_t>(integer(contract, "parameters"));
        out->contract.published = static_cast<std::uint32_t>(integer(contract, "published"));
        out->contract.streams = static_cast<std::uint32_t>(integer(contract, "streams"));
        out->contract.stateSize = static_cast<std::uint32_t>(integer(contract, "stateSize"));
        return out;
    }

    const Parameter* Plugin::parameterById(std::uint32_t vstId) const noexcept
    {
        const auto index = indexOf(vstId);
        return index ? &parameters[*index] : nullptr;
    }

    std::optional<std::size_t> Plugin::indexOf(std::uint32_t vstId) const noexcept
    {
        const auto found = byVstId.find(vstId);
        if (found == byVstId.end())
            return std::nullopt;
        return found->second;
    }

    std::optional<std::size_t> Plugin::indexOf(std::string_view parameterId) const noexcept
    {
        for (std::size_t i = 0; i < parameters.size(); ++i)
            if (parameters[i].info.id == parameterId)
                return i;
        return std::nullopt;
    }

    double Plugin::toValue(std::size_t index, double normalized) const noexcept
    {
        try
        {
            const auto& b = parameters.at(index).behavior;
            const Value input = Value::fromDouble(Base::Float64, normalized);
            return b.toValue.evaluate(&input, 1).toDouble(b.valueType);
        }
        catch (...)
        {
            return parameters.empty() || index >= parameters.size() ? 0 : parameters[index].info.defaultValue;
        }
    }

    double Plugin::toNormalized(std::size_t index, double plain) const noexcept
    {
        try
        {
            const auto& b = parameters.at(index).behavior;
            const Value input = Value::fromDouble(b.valueType, plain);
            return b.toNormalized.evaluate(&input, 1).d;
        }
        catch (...)
        {
            return 0;
        }
    }

    double Plugin::constrain(std::size_t index, double plain) const noexcept
    {
        try
        {
            const auto& b = parameters.at(index).behavior;
            const Value input = Value::fromDouble(Base::Float64, plain);
            return b.constrain.evaluate(&input, 1).toDouble(b.valueType);
        }
        catch (...)
        {
            return parameters.empty() || index >= parameters.size() ? 0 : parameters[index].info.defaultValue;
        }
    }

    std::string Plugin::format(std::size_t index, double plain) const
    {
        const auto& b = parameters.at(index).behavior;
        const Value input = Value::fromDouble(b.valueType, plain);
        return b.format.evaluate(&input, 1).s;
    }

    std::optional<double> Plugin::parse(std::size_t index, std::string_view text) const
    {
        const auto& b = parameters.at(index).behavior;
        Value input;
        input.s = std::string(text);
        const auto out = b.parse.evaluate(&input, 1);
        if (out.null)
            return std::nullopt;
        return out.toDouble(b.valueType);
    }

    const Plugin* plugin(std::string* error)
    {
        static std::once_flag once;
        static std::unique_ptr<Plugin> loaded;
        static std::string problem;
        std::call_once(once,
                       []
                       {
                           SoundorVst3Plugin abi {};
                           abi.size = sizeof abi;
                           if (soundor_vst3_plugin(&abi) != 0)
                           {
                               problem = "the plugin's Rust library does not describe a VST3 plugin";
                               log("Soundor: " + problem);
                               return;
                           }
                           if (abi.abiVersion != SOUNDOR_VST3_ABI_VERSION)
                           {
                               problem = "the plugin was built for VST3 runtime ABI " + std::to_string(abi.abiVersion)
                                         + ", this adapter speaks " + std::to_string(SOUNDOR_VST3_ABI_VERSION);
                               log("Soundor: " + problem);
                               return;
                           }
                           try
                           {
                               loaded = parseDescriptor(
                                   std::string_view(reinterpret_cast<const char*>(abi.descriptor), abi.descriptorSize));
                               loaded->controllerDescriptor.assign(
                                   abi.controllerDescriptor, abi.controllerDescriptor + abi.controllerDescriptorSize);
                               for (std::size_t i = 0; i < abi.fileCount; ++i)
                               {
                                   const auto& file = abi.files[i];
                                   loaded->files.push_back({ std::string_view(file.path, file.pathLength),
                                                             std::span<const std::uint8_t>(file.data, file.size) });
                               }
                               // State values in the adapter's canonical form (float32
                               // values as they round, 64-bit integers as strings).
                               const StateSchema schema(*loaded);
                               for (std::size_t i = 0; i < loaded->state.size(); ++i)
                                   loaded->state[i].defaultJson =
                                       schema.canonical(i, std::string_view(loaded->state[i].defaultJson));
                               for (auto& preset : loaded->presets)
                                   for (auto& [field, json] : preset.state)
                                       if (const auto index = schema.indexOf(field))
                                           json = schema.canonical(*index, std::string_view(json));
                               if (abi.logFileLength > 0)
                                   loaded->logFile = std::filesystem::path(std::string(abi.logFile, abi.logFileLength));
                               if (abi.uiDirectoryLength > 0)
                                   loaded->uiDirectory =
                                       std::filesystem::path(std::string(abi.uiDirectory, abi.uiDirectoryLength));
                           }
                           catch (const std::exception& failure)
                           {
                               loaded.reset();
                               problem = std::string("the plugin's descriptor is invalid: ") + failure.what();
                           }
                           if (! loaded)
                               log("Soundor: " + problem);
                       });
        if (! loaded && error != nullptr)
            *error = problem;
        return loaded.get();
    }
} // namespace soundor::vst3
