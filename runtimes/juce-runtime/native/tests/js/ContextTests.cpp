#include <soundor/js/Context.h>

#include <doctest/doctest.h>

#include <string>

using namespace soundor::js;

TEST_SUITE("Context")
{
    TEST_CASE("evaluates expressions to C++ values")
    {
        Runtime runtime;
        Context context(runtime);

        CHECK(context.evaluateScript("1 + 2").value() == Value::number(3));
        CHECK(context.evaluateScript("'sound' + 'or'").value() == Value::string("soundor"));
        CHECK(context.evaluateScript("1 < 2").value() == Value::boolean(true));
        CHECK(context.evaluateScript("null").value() == Value::null());
        CHECK(context.evaluateScript("undefined").value().isUndefined());
        CHECK(context.evaluateScript("'héllo ✓'").value().asString() == "héllo ✓");

        auto object = context.evaluateScript("({ toString() { return 'custom'; } })");
        REQUIRE(object.ok());
        CHECK(object.value().isOther());
        CHECK(object.value().toString() == "custom");

        CHECK(context.evaluateScript("10n ** 20n").value().toString() == "100000000000000000000");
        CHECK(context.evaluateScript("Symbol('s')").value().isOther());
    }

    TEST_CASE("keeps state between evaluations")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(context.evaluateScript("let count = 1;").ok());
        REQUIRE(context.evaluateScript("count += 41;").ok());
        CHECK(context.evaluateScript("count").value().asNumber() == 42);
    }

    TEST_CASE("formats numbers like JavaScript")
    {
        CHECK(Value::number(0.1).toString() == "0.1");
        CHECK(Value::number(42).toString() == "42");
        CHECK(Value::number(1.0 / 3.0).toString() == "0.3333333333333333");
    }

    TEST_CASE("exposes the ECMAScript language and no host environment")
    {
        Runtime runtime;
        Context context(runtime);

        for (const char* present : { "globalThis", "Promise", "Proxy", "Map", "WeakRef", "BigInt", "Uint8Array", "JSON",
                                     "RegExp", "Date", "eval" })
        {
            CAPTURE(present);
            auto type = context.evaluateScript(std::string("typeof ") + present);
            REQUIRE(type.ok());
            CHECK(type.value().asString() != "undefined");
        }

        // Soundor is neither a browser nor Node, and QuickJS's own host
        // environment (std/os, print, scriptArgs) is not part of it. The Web
        // platform layer adds deliberate globals later; none exist by default.
        for (const char* absent :
             { "window", "document", "self", "global", "process", "require", "module", "console", "print", "scriptArgs",
               "std", "os", "performance", "atob", "DOMException", "navigator", "setTimeout" })
        {
            CAPTURE(absent);
            auto type = context.evaluateScript(std::string("typeof ") + absent);
            REQUIRE(type.ok());
            CHECK(type.value().asString() == "undefined");
        }
    }
}
