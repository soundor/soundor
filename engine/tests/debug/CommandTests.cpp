#include <soundor/debug/Inspector.h>

#include <doctest/doctest.h>

#include <string>

using namespace soundor;

namespace
{
    using Object = debug::Value::Object;
    using Array = debug::Value::Array;
    debug::Value document(const std::string& json)
    {
        const auto value = debug::Value::parse(json);
        if (! value)
        {
            FAIL("not JSON: " << json);
            return {};
        }
        return *value;
    }
    debug::Command command(const std::string& json)
    {
        const auto parsed = debug::Command::parse(document(json));
        if (! parsed)
        {
            FAIL("not a command: " << json);
            return {};
        }
        return *parsed;
    }
    bool refused(const std::string& json)
    {
        return ! debug::Command::parse(document(json)).has_value();
    }
} // namespace

TEST_SUITE("Native DevTools commands")
{
    TEST_CASE("JSON reads back what the inspector writes")
    {
        const debug::Value value(Object {
            { "text", "a \"quoted\" line\nwith\ttabs, \\ and é" },
            { "numbers", Array { 0.5, -3, 1e21, 123456.789 } },
            { "nested", Object { { "flag", true }, { "none", nullptr }, { "empty", Array {} } } },
        });
        CHECK(document(value.json()).json() == value.json());
    }

    TEST_CASE("JSON escapes and surrogate pairs decode to UTF-8")
    {
        const auto parsed = document(R"(  ["é🎵", "\/"]  )");
        const auto& items = std::get<Array>(parsed.data);
        CHECK(std::get<std::string>(items[0].data) == "\xc3\xa9\xf0\x9f\x8e\xb5");
        CHECK(std::get<std::string>(items[1].data) == "/");
    }

    TEST_CASE("anything but JSON is refused")
    {
        for (const char* text : { "", "{", "[1,]", "{'a':1}", "01", "1.", "-", "NaN", R"("\ud800")", R"("\udc00")",
                                  R"("\x")", "\"a\nb\"", "[1] 2", "tru", R"({"a" 1})" })
            CHECK_MESSAGE(! debug::Value::parse(text).has_value(), text);
        std::string deep(65, '[');
        deep += std::string(65, ']');
        CHECK_FALSE(debug::Value::parse(deep).has_value());
        std::string shallow(64, '[');
        shallow += std::string(64, ']');
        CHECK(debug::Value::parse(shallow).has_value());
    }

    TEST_CASE("runtime commands decode with their parameters")
    {
        const auto request = command(R"({"type":"request","id":"t1","targetId":"x","method":"Input.dispatchPointer",
            "generation":2,"params":{"action":"click","x":10.5,"y":4,"node":{"generation":2,"id":"17"}}})");
        CHECK(request.id == "t1");
        CHECK(request.method == "Input.dispatchPointer");
        CHECK(request.targetGeneration == 2);
        CHECK(request.nodeRequested);
        CHECK(request.node == 17);
        CHECK(request.generation == 2);
        CHECK(std::get<double>(request.params.at("x").data) == 10.5);

        const auto picker = command(
            R"({"type":"request","id":"p","method":"UI.setPickerEnabled","generation":1,"params":{"enabled":true}})");
        CHECK(picker.enabled);
        CHECK_FALSE(picker.nodeRequested);

        const auto subscribe = command(R"({"type":"subscribe","events":["UI.treeChanged","Console.message"]})");
        CHECK(subscribe.method == "subscribe");
        CHECK(subscribe.events.size() == 2);

        CHECK(command(R"({"type":"cancel","id":"t1"})").method == "cancel");
        CHECK(command(R"({"type":"clientGone","client":"c1"})").client == "c1");
        CHECK(refused(R"({"type":"clientGone"})"));
    }

    TEST_CASE("malformed commands and node references are refused or unresolved")
    {
        CHECK(refused(R"({"type":"request","id":"a","method":"UI.getTree","params":{}})"));
        CHECK(refused(R"({"type":"request","id":"a","method":"UI.getTree","generation":0})"));
        CHECK(refused(R"({"type":"request","method":"UI.getTree","generation":1})"));
        CHECK(refused(R"({"type":"request","id":"a","method":"UI.getTree","generation":1,"params":[]})"));
        CHECK(refused(R"({"type":"launch","id":"a"})"));
        CHECK(refused(R"([1])"));
        // A node reference that is no engine node resolves to none: refused
        // later, as an unknown node, never as another node.
        const auto foreign = command(
            R"({"type":"request","id":"a","method":"UI.getNode","generation":1,"params":{"node":{"generation":1,"id":"0x10"}}})");
        CHECK(foreign.nodeRequested);
        CHECK(foreign.node == ui::noNode);
    }
}
