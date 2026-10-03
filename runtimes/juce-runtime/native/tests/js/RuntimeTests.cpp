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

    TEST_CASE("enforces the memory limit as a catchable error")
    {
        Runtime runtime(RuntimeOptions { .memoryLimit = std::size_t { 8 } * 1024 * 1024 });
        Context context(runtime);
        auto result = context.evaluateScript("const a = []; for (;;) a.push(new Array(1e5).fill(1));");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().toString().find("out of memory") != std::string::npos);

        // The runtime stays usable after hitting the limit.
        auto after = context.evaluateScript("1 + 1");
        REQUIRE(after.ok());
        CHECK(after.value().asNumber() == 2);
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
}
