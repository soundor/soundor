#include <soundor/js/Context.h>

#include <doctest/doctest.h>

#include <memory>

using namespace soundor::js;

// Leak detection: QuickJS asserts in debug builds when JS_FreeRuntime finds
// live objects, and the sanitizer preset adds LeakSanitizer. Every test here
// tears down with work in flight and must still release everything.

TEST_SUITE("Lifecycle")
{
    TEST_CASE("repeated create, evaluate and destroy does not grow")
    {
        for (int i = 0; i < 200; ++i)
        {
            Runtime runtime;
            Context context(runtime, ContextOptions { .moduleLoader = std::make_shared<MemoryModuleLoader>() });
            REQUIRE(context.evaluateScript("const big = new Array(1000).fill('x'); big.length").ok());
            REQUIRE(context.evaluateModule("export const x = await Promise.resolve(1);", "/m.js").ok());
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

    TEST_CASE("jobs left behind by a destroyed context run safely")
    {
        Runtime runtime;
        {
            auto loader = std::make_shared<MemoryModuleLoader>();
            loader->add("/late.js", "export default 1;");
            Context context(runtime, ContextOptions { .moduleLoader = loader });
            REQUIRE(context.evaluateScript("Promise.resolve().then(() => import('/late.js')).catch(() => {});").ok());
        }
        // The queued job tries a dynamic import after its context is gone; the
        // module hooks must refuse cleanly rather than touch freed state.
        runtime.runPendingJobs();
    }
}
