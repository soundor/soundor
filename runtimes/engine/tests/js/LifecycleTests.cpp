#include "../support/Modules.h"

#include <soundor/js/Context.h>

#include <doctest/doctest.h>

#include <memory>

using namespace soundor::js;

// Leak detection: a context asserts in debug builds that C++ holds no engine
// value any more when it frees its Hermes runtime, and the sanitizer preset
// adds LeakSanitizer. Every test here tears down with work in flight and must
// still release everything.

TEST_SUITE("Lifecycle")
{
    TEST_CASE("repeated create, evaluate and destroy does not grow")
    {
        for (int i = 0; i < 200; ++i)
        {
            Runtime runtime;
            Context context(runtime, ContextOptions { .moduleLoader = std::make_shared<MemoryModuleLoader>() });
            REQUIRE(context.evaluateScript("const big = new Array(1000).fill('x'); big.length").ok());
            REQUIRE(context.evaluateModule(soundor::test::module("export const x = await Promise.resolve(1);"), "/m.js")
                        .ok());
        }
    }

    TEST_CASE("a context can be recreated on one runtime without accumulating objects")
    {
        Runtime runtime;
        auto cycle = [&]
        {
            Context context(runtime);
            REQUIRE(context.evaluateScript("globalThis.data = Array.from({ length: 1000 }, (_, i) => ({ i }));").ok());
        };
        cycle();
        runtime.collectGarbage();
        const auto baseline = runtime.memoryUsage().objectCount;
        for (int i = 0; i < 50; ++i)
            cycle();
        runtime.collectGarbage();
        CHECK(runtime.memoryUsage().objectCount <= baseline);
    }

    TEST_CASE("tears down with pending jobs and unhandled rejections")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(context
                    .evaluateScript("Promise.resolve().then(() => {});"
                                    "Promise.reject(new Error('never observed'));")
                    .ok());
        CHECK(runtime.hasPendingJobs());
    }

    TEST_CASE("a context may outlive the Runtime object that created it")
    {
        auto runtime = std::make_unique<Runtime>();
        auto context = std::make_unique<Context>(*runtime);
        runtime.reset();
        CHECK(context->evaluateScript("40 + 2").value().asNumber() == 42);
        context.reset();
    }

    TEST_CASE("jobs left behind by a destroyed context go with it")
    {
        Runtime runtime;
        {
            auto loader = std::make_shared<MemoryModuleLoader>();
            loader->add("/late.js", soundor::test::module("export default 1;"));
            Context context(runtime, ContextOptions { .moduleLoader = loader });
            REQUIRE(
                context
                    .evaluateModule(soundor::test::module("globalThis.late = () => import('/late.js');"), "/early.js")
                    .ok());
            REQUIRE(context.evaluateScript("Promise.resolve().then(() => late()).catch(() => {}); 0").ok());
            CHECK(runtime.hasPendingJobs());
        }
        // A context's jobs are in its own engine: they went with it.
        CHECK_FALSE(runtime.hasPendingJobs());
        CHECK(runtime.runPendingJobs() == 0);
    }
}
