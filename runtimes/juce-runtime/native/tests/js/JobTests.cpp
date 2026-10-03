#include <soundor/js/Context.h>

#include <doctest/doctest.h>

#include <string>
#include <utility>
#include <vector>

using namespace soundor::js;

namespace
{
    struct CapturedLog
    {
        std::vector<std::pair<LogLevel, std::string>> entries;

        LogSink sink()
        {
            return [this](LogLevel level, std::string_view message) { entries.emplace_back(level, message); };
        }
    };
} // namespace

TEST_SUITE("Jobs")
{
    TEST_CASE("promise reactions run only when jobs are pumped")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(context.evaluateScript("globalThis.step = 0; Promise.resolve().then(() => { step = 1; });").ok());

        CHECK(runtime.hasPendingJobs());
        CHECK(context.evaluateScript("step").value().asNumber() == 0);

        CHECK(runtime.runPendingJobs() == 1);
        CHECK_FALSE(runtime.hasPendingJobs());
        CHECK(context.evaluateScript("step").value().asNumber() == 1);
    }

    TEST_CASE("pumping drains chained jobs")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(context
                    .evaluateScript(
                        "globalThis.order = [];"
                        "(async () => { order.push(1); await null; order.push(2); await null; order.push(3); })();")
                    .ok());
        runtime.runPendingJobs();
        CHECK(context.evaluateScript("order.join(',')").value().asString() == "1,2,3");
    }

    TEST_CASE("reports unhandled rejections through the log sink")
    {
        CapturedLog log;
        Runtime runtime(RuntimeOptions { .log = log.sink() });
        Context context(runtime);
        REQUIRE(context.evaluateScript("Promise.reject(new RangeError('lost'))").ok());
        runtime.runPendingJobs();

        REQUIRE(log.entries.size() == 1);
        CHECK(log.entries[0].first == LogLevel::Error);
        CHECK(log.entries[0].second.find("Unhandled promise rejection: RangeError: lost") == 0);
    }

    TEST_CASE("does not report rejections handled before the queue drains")
    {
        CapturedLog log;
        Runtime runtime(RuntimeOptions { .log = log.sink() });
        Context context(runtime);
        REQUIRE(context
                    .evaluateScript("const p = Promise.reject(new Error('late'));"
                                    "Promise.resolve().then(() => p.catch(() => {}));")
                    .ok());
        runtime.runPendingJobs();
        CHECK(log.entries.empty());
    }
}
