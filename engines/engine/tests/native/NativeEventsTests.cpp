// The `events` of the generated `soundor:native` (tests/generated, from the
// fixture in src/native-codegen.test.ts): published by native code on any
// thread, delivered to JavaScript by js::deliverEvents() on the context's.

#include "../support/Modules.h"

#include <soundor/js/Context.h>
#include <soundor/js/Events.h>
#include <soundor/native/SoundorNative.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace soundor;

namespace
{
    class NoMethods final : public native::NativeApi
    {
    public:
        std::int32_t add(std::int32_t a, std::int32_t b) override { return a + b; }
        native::Analysis analyze(std::span<const float>) override { return {}; }
        void applyPreset(native::Preset) override {}
        native::Point centroid(std::vector<native::Point>) override { return {}; }
        std::vector<native::Curve> curves() override { return {}; }
        native::Buffers echoBuffers(native::Buffers buffers) override { return buffers; }
        float echoFloat32(float value) override { return value; }
        std::int64_t echoInt64(std::int64_t value) override { return value; }
        native::Numbers echoNumbers(native::Numbers numbers) override { return numbers; }
        native::Optionals echoOptionals(native::Optionals optionals) override { return optionals; }
        std::uint64_t echoUint64(std::uint64_t value) override { return value; }
        std::uint8_t echoUint8(std::uint8_t value) override { return value; }
        void fail(std::string) override {}
        std::optional<native::Point> firstPoint(std::optional<std::vector<native::Point>>) override { return {}; }
        std::vector<float> getSpectrum() override { return {}; }
        std::string greet(std::string name) override { return name; }
        native::Curve invert(native::Curve curve) override { return curve; }
        bool isEven(std::int32_t value) override { return value % 2 == 0; }
        std::string joinTags(std::vector<std::string>) override { return {}; }
        void loadPreset(std::string, js::Promise<std::optional<native::Preset>> promise) override
        {
            promise.resolve(std::nullopt);
        }
        std::vector<float> makeRamp(std::uint32_t) override { return {}; }
        void reset() override {}
        std::vector<std::uint8_t> reverseBytes(std::span<const std::uint8_t>) override { return {}; }
        void save(native::Preset, js::Promise<void> promise) override { promise.resolve(); }
        std::vector<double> scale(std::span<const double>, double) override { return {}; }
        void setSolo(std::optional<std::int32_t>) override {}
        std::optional<std::int32_t> solo() override { return {}; }
        std::uint32_t sumBytes(std::span<const std::uint8_t>) override { return 0; }
        std::int64_t sumInts(std::span<const std::int32_t>) override { return 0; }
        std::optional<std::uint64_t> sumWords(std::optional<std::span<const std::uint64_t>>) override { return {}; }
    };

    // What a context logged, by level.
    struct Log
    {
        std::vector<std::string> warnings;
        std::vector<std::string> errors;

        js::RuntimeOptions options()
        {
            js::RuntimeOptions result;
            result.log = [this](js::LogLevel level, std::string_view message)
            {
                if (level == js::LogLevel::Warn)
                    warnings.emplace_back(message);
                else if (level == js::LogLevel::Error)
                    errors.emplace_back(message);
            };
            return result;
        }
    };

    struct Fixture
    {
        explicit Fixture(native::Events& source, const js::RuntimeOptions& options = {}) : runtime(options)
        {
            native::install(context, std::make_shared<NoMethods>(), source, channels);
        }

        void run(const std::string& body)
        {
            const auto evaluated = context.evaluateModule(
                soundor::test::module(std::string("import { events } from 'soundor:native';\n") + body),
                "/test" + std::to_string(++counter) + ".js");
            REQUIRE_MESSAGE(evaluated.ok(), (evaluated.ok() ? "" : evaluated.error().toString()));
        }

        std::string text(const std::string& expression)
        {
            const auto value = context.evaluateScript(expression);
            REQUIRE_MESSAGE(value.ok(), (value.ok() ? "" : value.error().toString()));
            return value.value().asString();
        }

        double number(const std::string& expression)
        {
            const auto value = context.evaluateScript(expression);
            REQUIRE_MESSAGE(value.ok(), (value.ok() ? "" : value.error().toString()));
            return value.value().asNumber();
        }

        native::Channels channels;
        js::Runtime runtime;
        js::Context context { runtime };
        int counter = 0;
    };

    constexpr const char* recordAll = R"(
        globalThis.log = [];
        events.presetLoaded.subscribe((e) => log.push('loaded ' + e.path + ' ' + (e.preset === null ? 'none' : e.preset.name + ':' + e.preset.gains.join('/'))));
        events.levels.subscribe((e) => log.push('levels ' + e.values.constructor.name + ' ' + Array.from(e.values).join('/') + ' ' + e.curve));
        events.ready.subscribe((e) => log.push('ready ' + Object.keys(e).length));
    )";
} // namespace

TEST_SUITE("soundor:native events")
{
    TEST_CASE("exports one frozen subscribable event per declaration")
    {
        native::Events source;
        Fixture f(source);
        f.run("globalThis.events = events; globalThis.names = Object.keys(events).sort().join();"
              "globalThis.frozen = Object.isFrozen(events) && Object.isFrozen(events.ready);");
        CHECK(f.text("names") == "levels,presetLoaded,ready");
        CHECK(f.text("String(frozen)") == "true");
        CHECK(f.text("(() => { try { events.ready.subscribe(1); } catch (e) { return e.name + ': ' + e.message; } "
                     "})()")
              == "TypeError: events.ready.subscribe() expects a function, got number");
    }

    TEST_CASE("delivers values in the order published, on deliverEvents() only")
    {
        native::Events source;
        Fixture f(source);
        f.run(recordAll);
        CHECK(
            source.presetLoaded({ .path = "a.json", .preset = native::Preset { .name = "Warm", .gains = { 1, 2 } } }));
        CHECK(source.levels({ .values = { 0.5F, 0.25F }, .curve = native::Curve::LowCut }));
        CHECK(source.ready());
        CHECK(source.presetLoaded({ .path = "b.json", .preset = std::nullopt }));
        // Nothing runs JavaScript before the context's own thread delivers.
        CHECK(f.number("log.length") == 0);
        CHECK(js::deliverEvents(f.context) == 4);
        CHECK(f.text("log.join('|')")
              == "loaded a.json Warm:1/2|levels Float32Array 0.5/0.25 low-cut|ready 0|loaded b.json none");
        CHECK(js::deliverEvents(f.context) == 0);
        CHECK(source.statistics().published == 4);
        CHECK(source.statistics().dropped == 0);
    }

    TEST_CASE("every subscriber receives the same value; unsubscribing stops one")
    {
        native::Events source;
        Fixture f(source);
        f.run(R"(
            globalThis.seen = [];
            const first = events.presetLoaded.subscribe((e) => { seen.push('first ' + e.path); globalThis.firstValue = e; });
            events.presetLoaded.subscribe((e) => { seen.push('second ' + e.path); globalThis.same = globalThis.firstValue === e; });
            globalThis.stopFirst = first;
        )");
        source.presetLoaded({ .path = "x" });
        js::deliverEvents(f.context);
        CHECK(f.text("seen.join()") == "first x,second x");
        CHECK(f.text("String(same)") == "true");
        f.run("stopFirst(); stopFirst();");
        source.presetLoaded({ .path = "y" });
        js::deliverEvents(f.context);
        CHECK(f.text("seen.join()") == "first x,second x,second y");
    }

    TEST_CASE("subscribing or unsubscribing during a dispatch")
    {
        native::Events source;
        Fixture f(source);
        f.run(R"(
            globalThis.seen = [];
            let stopSecond;
            events.ready.subscribe(() => {
                seen.push('first');
                stopSecond();
                events.ready.subscribe(() => seen.push('late'));
            });
            stopSecond = events.ready.subscribe(() => seen.push('second'));
        )");
        source.ready();
        js::deliverEvents(f.context);
        // Removed during the dispatch: not called; added during it: from the next event.
        CHECK(f.text("seen.join()") == "first");
        source.ready();
        js::deliverEvents(f.context);
        CHECK(f.text("seen.join()") == "first,first,late");
    }

    TEST_CASE("a throwing subscriber is logged and the others still run")
    {
        Log log;
        native::Events source;
        Fixture f(source, log.options());
        f.run(R"(
            globalThis.seen = [];
            events.ready.subscribe(() => { throw new Error('boom'); });
            events.ready.subscribe(() => seen.push('after'));
        )");
        source.ready();
        js::deliverEvents(f.context);
        CHECK(f.text("seen.join()") == "after");
        REQUIRE(log.errors.size() == 1);
        CHECK(log.errors[0].starts_with("soundor:native event subscriber threw: Error: boom"));
    }

    TEST_CASE("a full context drops newer events, counts and reports them")
    {
        Log log;
        native::Events source(js::EventSource::Options { .capacity = 3 });
        Fixture f(source, log.options());
        f.run("globalThis.paths = []; events.presetLoaded.subscribe((e) => paths.push(e.path));");
        for (int index = 0; index < 5; ++index)
            CHECK(source.presetLoaded({ .path = std::to_string(index) }) == (index < 3));
        CHECK(source.statistics().dropped == 2);
        CHECK(js::deliverEvents(f.context) == 3);
        CHECK(f.text("paths.join()") == "0,1,2");
        REQUIRE(log.warnings.size() == 1);
        CHECK(log.warnings[0]
              == "soundor:native: 2 events were dropped: the UI did not take them in time (it holds 3)");
        // Delivering made room again.
        CHECK(source.presetLoaded({ .path = "5" }));
        js::deliverEvents(f.context);
        CHECK(f.text("paths.join()") == "0,1,2,5");
        CHECK(log.warnings.size() == 1);
    }

    TEST_CASE("without a connected context, events are dropped")
    {
        native::Events source;
        CHECK_FALSE(source.ready());
        CHECK(source.statistics().published == 1);
        CHECK(source.statistics().dropped == 1);
    }

    TEST_CASE("events published before the module is imported are not kept")
    {
        native::Events source;
        Fixture f(source);
        source.ready();
        // Nobody imported soundor:native: nothing to call, nothing kept.
        CHECK(js::deliverEvents(f.context) == 1);
        f.run("globalThis.count = 0; events.ready.subscribe(() => ++globalThis.count);");
        js::deliverEvents(f.context);
        CHECK(f.number("count") == 0);
        source.ready();
        js::deliverEvents(f.context);
        CHECK(f.number("count") == 1);
    }

    TEST_CASE("every connected context receives every event")
    {
        native::Events source;
        Fixture first(source);
        Fixture second(source);
        first.run("globalThis.count = 0; events.ready.subscribe(() => ++globalThis.count);");
        second.run("globalThis.count = 0; events.ready.subscribe(() => ++globalThis.count);");
        source.ready();
        source.ready();
        js::deliverEvents(first.context);
        js::deliverEvents(second.context);
        CHECK(first.number("count") == 2);
        CHECK(second.number("count") == 2);
    }

    TEST_CASE("publishing from several threads keeps each thread's order")
    {
        native::Events source(js::EventSource::Options { .capacity = 4096 });
        Fixture f(source);
        f.run("globalThis.paths = []; events.presetLoaded.subscribe((e) => paths.push(e.path));");
        constexpr int threads = 4;
        constexpr int perThread = 250;
        std::vector<std::thread> producers;
        producers.reserve(threads);
        for (int thread = 0; thread < threads; ++thread)
            producers.emplace_back(
                [&source, thread]
                {
                    for (int index = 0; index < perThread; ++index)
                        source.presetLoaded({ .path = std::to_string(thread) + ":" + std::to_string(index) });
                });
        // Delivering while they publish.
        constexpr std::size_t total = std::size_t { threads } * perThread;
        std::size_t delivered = 0;
        while (delivered < total)
            delivered += js::deliverEvents(f.context);
        for (auto& producer : producers)
            producer.join();
        CHECK(delivered == total);
        CHECK(f.text(R"((() => {
            const next = [0, 0, 0, 0];
            for (const path of paths) {
                const [thread, index] = path.split(':').map(Number);
                if (index !== next[thread]) return 'thread ' + thread + ' out of order at ' + path;
                next[thread] = index + 1;
            }
            return next.join();
        })())")
              == "250,250,250,250");
    }

    TEST_CASE("a context going, or the source going, is clean either way")
    {
        native::Events source;
        {
            Fixture f(source);
            f.run("events.ready.subscribe(() => {});");
            source.ready();
            // Destroyed with an event undelivered.
        }
        CHECK_FALSE(source.ready());

        auto early = std::make_unique<native::Events>();
        Fixture f(*early);
        f.run("globalThis.count = 0; events.ready.subscribe(() => ++globalThis.count);");
        early->ready();
        early.reset();
        // What it published before it went is still delivered.
        CHECK(js::deliverEvents(f.context) == 1);
        CHECK(f.number("count") == 1);
    }

    TEST_CASE("a reloaded UI receives events from when it connected")
    {
        native::Events source;
        auto first = std::make_unique<Fixture>(source);
        first->run("globalThis.count = 0; events.ready.subscribe(() => ++globalThis.count);");
        source.ready();
        // Reload: the old context goes, its undelivered event with it.
        first.reset();
        source.ready();
        Fixture second(source);
        second.run("globalThis.count = 0; events.ready.subscribe(() => ++globalThis.count);");
        source.ready();
        js::deliverEvents(second.context);
        CHECK(second.number("count") == 1);
    }

    TEST_CASE("RuntimeHost::tick delivers them")
    {
        native::Events source;
        RuntimeHost::Options options;
        native::Channels channels;
        options.installModules = [&source, &channels](js::Context& context)
        { native::install(context, std::make_shared<NoMethods>(), source, channels); };
        RuntimeHost host(std::move(options));
        REQUIRE(host.context()
                    .evaluateModule(soundor::test::module("import { events } from 'soundor:native';"
                                                          "globalThis.count = 0;"
                                                          "events.ready.subscribe(() => ++globalThis.count);"),
                                    "/ui.js")
                    .ok());
        source.ready();
        host.tick();
        CHECK(host.context().evaluateScript("count").value().asNumber() == 1);
    }
}
