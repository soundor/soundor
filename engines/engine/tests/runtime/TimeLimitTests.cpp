// RuntimeOptions::timeLimit: JavaScript that runs too long is stopped, in the
// engine (js::Context) and in a RuntimeHost's ticks.

#include "../web/WebTestSupport.h"

#include <soundor/js/Context.h>
#include <soundor/js/Runtime.h>

#include <doctest/doctest.h>

#include <chrono>
#include <string>

using namespace soundor;
using namespace std::chrono_literals;
using test::WebFixture;

namespace
{
    js::RuntimeOptions limited(std::chrono::milliseconds limit)
    {
        js::RuntimeOptions options;
        options.timeLimit = limit;
        return options;
    }

    // How long `run` takes.
    template <typename Run>
    std::chrono::milliseconds timed(Run&& run)
    {
        const auto start = std::chrono::steady_clock::now();
        run();
        return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start);
    }

    // Script that keeps the engine busy for about `ms` milliseconds.
    std::string busyFor(int ms)
    {
        return "{ const end = Date.now() + " + std::to_string(ms) + "; while (Date.now() < end) {} }";
    }

    void checkStopped(const js::Error& error)
    {
        CHECK(error.name == "TimeoutError");
        CHECK(error.message.find("ran longer than its time limit") != std::string::npos);
    }
} // namespace

TEST_SUITE("time limit")
{
    TEST_CASE("stops a script that never returns, and the context fails from then on")
    {
        js::Runtime runtime(limited(200ms));
        js::Context context(runtime);
        js::Result<js::Value> result = js::Value::undefined();
        const auto took = timed([&] { result = context.evaluateScript("for (;;) {}", "/spin.js"); });
        REQUIRE_FALSE(result.ok());
        checkStopped(result.error());
        CHECK(result.error().message.find("(200 ms)") != std::string::npos);
        // Where it was stopped.
        CHECK(result.error().stack.find("/spin.js:1") != std::string::npos);
        CHECK(took >= 200ms);
        CHECK(took < 2s);

        // It may have left anything half done: the context does not go on.
        auto after = context.evaluateScript("1 + 1");
        REQUIRE_FALSE(after.ok());
        checkStopped(after.error());
        // A new one (a reload) works.
        js::Context fresh(runtime);
        CHECK(fresh.evaluateScript("1 + 1").value().asNumber() == 2);
    }

    TEST_CASE("JavaScript cannot catch it")
    {
        js::Runtime runtime(limited(200ms));
        js::Context context(runtime);
        auto result = context.evaluateScript("for (;;) { try { for (;;) {} } catch (e) {} } 'finished'");
        REQUIRE_FALSE(result.ok());
        checkStopped(result.error());
    }

    TEST_CASE("stops promise jobs: one that never returns, and jobs that never stop queueing jobs")
    {
        const char* scripts[] = {
            "Promise.resolve().then(() => { for (;;) {} });",
            "function again() { Promise.resolve().then(again); } again();",
        };
        for (const char* script : scripts)
        {
            CAPTURE(script);
            js::Runtime runtime(limited(200ms));
            js::Context context(runtime);
            REQUIRE(context.evaluateScript(script).ok());
            const auto took = timed([&] { runtime.runPendingJobs(); });
            CHECK(took < 2s);
            CHECK_FALSE(runtime.hasPendingJobs());
            auto after = context.evaluateScript("1");
            REQUIRE_FALSE(after.ok());
            checkStopped(after.error());
        }
    }

    TEST_CASE("each call gets the whole limit; a scope makes calls share one")
    {
        js::Runtime runtime(limited(500ms));
        js::Context context(runtime);
        // Three calls of 200 ms each: none alone reaches the limit.
        for (int i = 0; i < 3; ++i)
            REQUIRE(context.evaluateScript(busyFor(200)).ok());

        js::Context grouped(runtime);
        {
            const js::TimeLimitScope scope(grouped);
            REQUIRE(grouped.evaluateScript(busyFor(200)).ok());
            REQUIRE(grouped.evaluateScript(busyFor(200)).ok());
            // A finite third call can finish before a delayed monitor thread
            // gets CPU on a busy runner. Wait for the interrupt instead, and
            // verify that this call gets only the scope's remaining budget,
            // rather than a fresh whole limit.
            js::Result<js::Value> third = js::Value::undefined();
            const auto remaining = timed([&] { third = grouped.evaluateScript("for (;;) {}"); });
            REQUIRE_FALSE(third.ok());
            checkStopped(third.error());
            CHECK(remaining < 500ms);
        }
    }

    TEST_CASE("no limit by default")
    {
        js::Runtime runtime;
        js::Context context(runtime);
        CHECK(context.evaluateScript(busyFor(300)).ok());
    }

    TEST_CASE("a tick that never ends is stopped, and later ticks do nothing")
    {
        RuntimeHost::Options options;
        options.runtime.timeLimit = 200ms;
        WebFixture f(std::move(options));
        f.eval("globalThis.frames = 0; requestAnimationFrame(() => { for (;;) {} });"
               "setInterval(() => { globalThis.frames++; }, 0);");
        const auto took = timed([&] { f.host.tick(); });
        CHECK(took < 2s);
        bool logged = false;
        for (const auto& [level, message] : f.logs)
            logged = logged || message.find("ran longer than its time limit") != std::string::npos;
        CHECK(logged);
        CHECK(timed([&] { f.host.tick(); }) < 100ms);
        auto after = f.host.context().evaluateScript("globalThis.frames");
        REQUIRE_FALSE(after.ok());
        checkStopped(after.error());
    }

    TEST_CASE("ordinary ticks stay well inside the limit")
    {
        RuntimeHost::Options options;
        options.runtime.timeLimit = 1000ms;
        WebFixture f(std::move(options));
        f.eval("globalThis.ticks = 0; setInterval(() => { globalThis.ticks++; " + busyFor(20) + " }, 0);");
        REQUIRE(f.tickUntil("globalThis.ticks >= 20"));
    }
}
