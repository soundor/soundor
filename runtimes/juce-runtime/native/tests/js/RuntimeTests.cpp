#include <soundor/js/Context.h>
#include <soundor/js/Runtime.h>

#include <doctest/doctest.h>

#include <memory>
#include <vector>

using namespace soundor::js;

TEST_SUITE("Runtime")
{
    TEST_CASE("creates and destroys an engine")
    {
        Runtime runtime;
        CHECK_FALSE(runtime.hasPendingJobs());
        CHECK(runtime.memoryUsage().allocatedBytes == 0); // no context, no engine yet
        Context context(runtime);
        CHECK(runtime.memoryUsage().allocatedBytes > 0);
    }

    TEST_CASE("independent runtimes coexist and do not share globals")
    {
        Runtime first;
        Runtime second;
        Context a(first);
        Context b(second);

        REQUIRE(a.evaluateScript("globalThis.shared = 'a'; shared").ok());
        auto lookup = b.evaluateScript("typeof globalThis.shared");
        REQUIRE(lookup.ok());
        CHECK(lookup.value() == Value::string("undefined"));
    }

    TEST_CASE("contexts of one runtime are separate realms")
    {
        Runtime runtime;
        Context a(runtime);
        Context b(runtime);
        REQUIRE(a.evaluateScript("globalThis.x = 1").ok());
        CHECK(b.evaluateScript("typeof x").value() == Value::string("undefined"));
    }

    TEST_CASE("enforces the memory limit as an error, not a crash")
    {
        Runtime runtime(RuntimeOptions { .memoryLimit = std::size_t { 8 } * 1024 * 1024 });
        Context context(runtime);
        auto result = context.evaluateScript("const a = []; for (;;) a.push(new Array(1e5).fill(1));");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().toString().find("out of memory") != std::string::npos);

        // Hermes cannot go on in a heap that ran out: the context fails from
        // then on, and a new one (a reload) works.
        auto after = context.evaluateScript("1 + 1");
        REQUIRE_FALSE(after.ok());
        CHECK(after.error().toString().find("out of memory") != std::string::npos);
        Context fresh(runtime);
        auto again = fresh.evaluateScript("1 + 1");
        REQUIRE(again.ok());
        CHECK(again.value().asNumber() == 2);
    }

    TEST_CASE("turns runaway recursion into an error instead of a crash")
    {
        Runtime runtime;
        Context context(runtime);
        auto result = context.evaluateScript("function f() { return f() + 1; } f();");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().name == "RangeError");
        CHECK(result.error().message.find("stack") != std::string::npos);
    }

    TEST_CASE("compiles no source from JavaScript, as without the compiler")
    {
        Runtime runtime;
        Context context(runtime);
        for (const char* expression : { "eval('1 + 1')", "(0, eval)('1 + 1')", "new Function('return 2')()",
                                        "Function('return 2')()", "(function () {}).constructor('return 3')()",
                                        "Object.getPrototypeOf(function* () {}).constructor('yield 1')",
                                        "Object.getPrototypeOf(async function () {}).constructor('return 1')" })
        {
            CAPTURE(expression);
            auto result = context.evaluateScript(expression);
            REQUIRE_FALSE(result.ok());
            CHECK(result.error().name == "SyntaxError");
            CHECK(result.error().message.find("Parsing source code unsupported") != std::string::npos);
        }
        // The host still evaluates source (development, the tests).
        CHECK(context.evaluateScript("1 + 1").value().asNumber() == 2);
    }
}
