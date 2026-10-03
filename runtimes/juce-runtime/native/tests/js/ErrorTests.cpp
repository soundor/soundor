#include <soundor/js/Context.h>

#include <doctest/doctest.h>

using namespace soundor::js;

TEST_SUITE("Errors")
{
    TEST_CASE("propagates thrown errors with name, message and stack")
    {
        Runtime runtime;
        Context context(runtime);
        auto result =
            context.evaluateScript("function explode() { throw new TypeError('bad input'); }\nexplode();", "app.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().name == "TypeError");
        CHECK(result.error().message == "bad input");
        CHECK(result.error().toString() == "TypeError: bad input");
        CHECK(result.error().stack.find("explode") != std::string::npos);
        CHECK(result.error().stack.find("app.js") != std::string::npos);
    }

    TEST_CASE("reports syntax errors")
    {
        Runtime runtime;
        Context context(runtime);
        auto result = context.evaluateScript("let = ;", "broken.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().name == "SyntaxError");
    }

    TEST_CASE("converts thrown non-Error values")
    {
        Runtime runtime;
        Context context(runtime);

        auto number = context.evaluateScript("throw 42");
        REQUIRE_FALSE(number.ok());
        CHECK(number.error().name.empty());
        CHECK(number.error().toString() == "42");

        auto hostile = context.evaluateScript("throw { toString() { throw new Error('nope'); } }");
        REQUIRE_FALSE(hostile.ok());
        CHECK(hostile.error().message == "[unconvertible value]");
    }

    TEST_CASE("custom Error subclasses keep their name")
    {
        Runtime runtime;
        Context context(runtime);
        auto result = context.evaluateScript(
            "class PresetError extends Error { constructor(m) { super(m); this.name = 'PresetError'; } }\n"
            "throw new PresetError('missing');");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().toString() == "PresetError: missing");
    }

    TEST_CASE("the context stays usable after an exception")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE_FALSE(context.evaluateScript("null.x").ok());
        CHECK(context.evaluateScript("'still alive'").value().asString() == "still alive");
    }
}
