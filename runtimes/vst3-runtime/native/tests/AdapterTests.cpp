// The adapter's parts that need no host: the expression interpreter
// (against @soundor/expression's corpus and its JavaScript results), the
// descriptor's parameter behaviour, persistent state and saved documents.
// The VST3 classes are tested through a real plugin in a real host
// (tests/plugin.test.ts) and pluginval.

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "Descriptor.h"
#include "Expression.h"
#include "State.h"
#include "StateDocument.h"

#include <soundor/json/Json.h>

#include <doctest/doctest.h>

#include <array>
#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>

using namespace soundor::vst3;
namespace json = soundor::json;

namespace
{
    // An optional the test needs: its value, or the test case fails.
    template <typename T>
    T present(const std::optional<T>& value)
    {
        if (! value)
            throw std::runtime_error("an expected value is absent");
        return *value;
    }

    std::string readFile(const char* path)
    {
        std::ifstream in(path, std::ios::binary);
        std::stringstream text;
        text << in.rdbuf();
        return text.str();
    }

    // A corpus value (expression-corpus.ts's encode()) as the interpreter's.
    expression::Value decode(const expression::Type& type, const json::Value& value)
    {
        expression::Value out;
        if (value.isNull())
        {
            out.null = true;
            return out;
        }
        using expression::Base;
        switch (type.base)
        {
            case Base::Boolean:
                out.b = value.asBoolean();
                return out;
            case Base::String:
                out.s = value.asString();
                return out;
            case Base::Float32:
            case Base::Float64:
            {
                double number = 0;
                if (value.asString() == "NaN")
                    number = std::numeric_limits<double>::quiet_NaN();
                else
                {
                    const auto bits = std::stoull(value.asString().substr(2), nullptr, 16);
                    std::memcpy(&number, &bits, sizeof number);
                }
                if (type.base == Base::Float32)
                    out.f = static_cast<float>(number);
                else
                    out.d = number;
                return out;
            }
            default:
                break;
        }
        const auto number = value.isString() ? json::Value::numberText(value.asString()) : value;
        if (expression::isSigned(type.base))
            out.i = present(number.asInt64());
        else
            out.u = present(number.asUint64());
        return out;
    }

    // An interpreter result as the corpus encodes it.
    json::Value encode(const expression::Type& type, const expression::Value& value)
    {
        using expression::Base;
        if (type.nullable && value.null)
            return json::Value::null();
        switch (type.base)
        {
            case Base::Boolean:
                return json::Value::boolean(value.b);
            case Base::String:
                return json::Value::string(value.s);
            case Base::Float32:
            case Base::Float64:
            {
                const double number = type.base == Base::Float32 ? static_cast<double>(value.f) : value.d;
                if (std::isnan(number))
                    return json::Value::string("NaN");
                std::uint64_t bits = 0;
                std::memcpy(&bits, &number, sizeof bits);
                char buffer[32];
                std::snprintf(buffer, sizeof buffer, "0x%016llx", static_cast<unsigned long long>(bits));
                return json::Value::string(buffer);
            }
            case Base::Int64:
                return json::Value::string(std::to_string(value.i));
            case Base::Uint64:
                return json::Value::string(std::to_string(value.u));
            default:
                return expression::isSigned(type.base) ? json::Value::integer(value.i)
                                                       : json::Value::unsignedInteger(value.u);
        }
    }

    // A descriptor of one plugin, as descriptor.ts writes one (abridged: the
    // parameter's behaviour is a linear mapping written by hand).
    std::string descriptor()
    {
        return readFile(SOUNDOR_VST3_TEST_DESCRIPTOR);
    }
} // namespace

TEST_CASE("expressions: the interpreter computes @soundor/expression's corpus bit for bit")
{
    const auto corpus =
        json::parse(readFile(SOUNDOR_VST3_EXPRESSION_CORPUS), { 64, 10000000, std::size_t { 64 } * 1024 * 1024 });
    std::size_t checked = 0;
    for (const auto& test : corpus.at("cases").asArray())
    {
        const auto& name = test.at("name").asString();
        std::vector<expression::Expression::Input> inputs;
        for (const auto& input : test.at("inputs").asArray())
            inputs.push_back({ input.at("name").asString(), expression::parseType(input.at("type").asString()) });
        const auto compiled = expression::Expression::compile(test.at("expression"), inputs);
        for (const auto& sample : test.at("samples").asArray())
        {
            std::vector<expression::Value> values;
            const auto& given = sample.at("values").asArray();
            for (std::size_t i = 0; i < inputs.size(); ++i)
                values.push_back(decode(inputs[i].type, given[i]));
            const auto result = compiled.evaluate(values.data(), values.size());
            INFO(name << " " << json::write(sample.at("values")));
            CHECK(json::write(encode(compiled.type(), result)) == json::write(sample.at("result")));
            ++checked;
        }
    }
    CHECK(checked > 150);
}

TEST_CASE("expressions: refused trees")
{
    const auto input = json::parse(R"({"kind":"input","type":"float64","name":"x"})");
    CHECK_THROWS_AS(static_cast<void>(expression::Expression::compile(input, {})), json::Error);
    const auto unknown = json::parse(R"({"kind":"lambda","type":"float64"})");
    CHECK_THROWS_AS(static_cast<void>(expression::Expression::compile(unknown, {})), json::Error);
}

TEST_CASE("descriptor: parameters' behaviour, ids, buses, state and presets")
{
    const auto plugin = parseDescriptor(descriptor());
    REQUIRE(plugin->parameters.size() == 2);
    CHECK(plugin->name == "Test");
    // 0102030405060708090A0B0C0D0E0F10: on Windows, a GUID's layout (the
    // first three groups little-endian), as the SDK keeps it there.
#ifdef _WIN32
    const ClassId processor { 0x04, 0x03, 0x02, 0x01, 0x06, 0x05, 0x08, 0x07,
                              0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10 };
#else
    const ClassId processor { 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                              0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10 };
#endif
    CHECK(plugin->processorCid == processor);
    CHECK(plugin->controllerCid[15] == 0xAB);
    CHECK(plugin->inputs.size() == 1);
    CHECK(plugin->layouts.size() == 2);
    CHECK(plugin->midiInput);
    // gain: 0..2, linear.
    CHECK(plugin->toValue(0, 0.5) == doctest::Approx(1.0));
    CHECK(plugin->toNormalized(0, 1.5) == doctest::Approx(0.75));
    CHECK(plugin->constrain(0, 9) == doctest::Approx(2.0));
    CHECK(plugin->format(0, 1.25) == "1.25 x");
    CHECK(plugin->parse(0, "0.5") == doctest::Approx(0.5));
    CHECK_FALSE(plugin->parse(0, "loud").has_value());
    CHECK(plugin->indexOf(std::uint32_t { 3165055 }) == std::optional<std::size_t>(0));
    CHECK(plugin->indexOf(std::string_view("on")) == std::optional<std::size_t>(1));
    CHECK(plugin->presets.size() == 1);
    CHECK_THROWS_AS(static_cast<void>(parseDescriptor(R"({"format":2})")), json::Error);
}

TEST_CASE("state: canonical values by type, the audio snapshot, documents")
{
    const auto plugin = parseDescriptor(descriptor());
    const StateSchema schema(*plugin);
    const auto level = present(schema.indexOf("level"));
    const auto seed = present(schema.indexOf("seed"));
    const auto band = present(schema.indexOf("band"));
    const auto steps = present(schema.indexOf("steps"));
    CHECK(schema.canonical(level, std::string_view("0.1")) == "0.10000000149011612");
    CHECK(schema.canonical(seed, std::string_view("\"18446744073709551615\"")) == "\"18446744073709551615\"");
    CHECK_THROWS_AS(static_cast<void>(schema.canonical(seed, std::string_view("\"007\""))), std::invalid_argument);
    CHECK_THROWS_AS(static_cast<void>(schema.canonical(seed, std::string_view("7"))), std::invalid_argument);
    // Struct fields in declared order; an enum's values; nullable.
    CHECK(schema.canonical(band, std::string_view(R"({"shape":"saw","gain":2})")) == R"({"gain":2,"shape":"saw"})");
    CHECK_THROWS_AS(static_cast<void>(schema.canonical(band, std::string_view(R"({"gain":2,"shape":"noise"})"))),
                    std::invalid_argument);
    CHECK_THROWS_AS(static_cast<void>(schema.canonical(band, std::string_view(R"({"gain":2})"))),
                    std::invalid_argument);
    CHECK(schema.canonical(steps, std::string_view("[1,2,3,4]")) == "[1,2,3,4]");
    CHECK_THROWS_AS(static_cast<void>(schema.canonical(steps, std::string_view("[1,2,3,4,5]"))), std::invalid_argument);
    CHECK_THROWS_AS(static_cast<void>(schema.canonical(steps, std::string_view("[1.5]"))), std::invalid_argument);

    // The audio snapshot: level (float32) at 0, steps (int32[4]) after.
    auto values = schema.defaults();
    values["level"] = "0.5";
    values["steps"] = "[7,8]";
    std::array<std::byte, 64> snapshot {};
    REQUIRE(schema.audioSize() <= snapshot.size());
    schema.writeAudio(values, snapshot);
    float stored = 0;
    std::memcpy(&stored, snapshot.data(), sizeof stored);
    CHECK(stored == 0.5f);
    std::uint32_t length = 0;
    std::memcpy(&length, snapshot.data() + 4, sizeof length);
    CHECK(length == 2);
    std::int32_t second = 0;
    std::memcpy(&second, snapshot.data() + 12, sizeof second);
    CHECK(second == 8);

    // A saved document, and back.
    const std::vector<double> parameters { 1.5, 1 };
    const auto text = writeStateDocument(*plugin, schema, parameters, values);
    CHECK(text.find("\"parameters\":{\"gain\":1.5,\"on\":true}") != std::string::npos);
    const auto read = readStateDocument(*plugin, schema, text);
    CHECK(read.parameters == parameters);
    CHECK(read.state.at("steps") == "[7,8]");
    // Absent members take their defaults; malformed ones are refused.
    const auto partial = readStateDocument(*plugin, schema, R"({"version":1,"parameters":{"on":false}})");
    CHECK(partial.parameters[0] == doctest::Approx(1.0));
    CHECK(partial.parameters[1] == 0);
    CHECK(partial.state.at("level") == plugin->state[present(schema.indexOf("level"))].defaultJson);
    CHECK_THROWS_AS(static_cast<void>(readStateDocument(*plugin, schema, R"({"version":1,"parameters":{"gain":3}})")),
                    std::invalid_argument);
    CHECK_THROWS_AS(static_cast<void>(readStateDocument(*plugin, schema, R"({"version":2})")), std::invalid_argument);
    CHECK_THROWS_AS(static_cast<void>(readStateDocument(*plugin, schema, "<xml/>")), std::invalid_argument);
}

TEST_CASE("state: the store's edits, History and notifications")
{
    const auto plugin = parseDescriptor(descriptor());
    const StateSchema schema(*plugin);
    soundor::history::StateHistory history;
    StateStore store(history);
    for (std::size_t i = 0; i < schema.size(); ++i)
        store.initialize(schema.field(i).name, schema.field(i).defaultJson,
                         [&schema, i](const std::string& json)
                         {
                             if (schema.canonical(i, std::string_view(json)) != json)
                                 throw std::invalid_argument("not canonical");
                         });
    std::vector<std::string> heard;
    const auto unsubscribe = store.subscribe("label", [&](const std::string& value) { heard.push_back(value); });
    store.set("label", "\"One\"", soundor::history::Options(std::string("Rename")));
    CHECK(store.get("label") == "\"One\"");
    CHECK(heard == std::vector<std::string> { "\"One\"" });
    CHECK(history.canUndo());
    history.undo();
    CHECK(store.get("label") == plugin->state[present(schema.indexOf("label"))].defaultJson);
    CHECK(heard.size() == 2);
    CHECK_THROWS(store.set("label", "\"One\" "));
    store.replace({ { "label", "\"Restored\"" } });
    CHECK(store.committed("label") == "\"Restored\"");
    unsubscribe();
}
