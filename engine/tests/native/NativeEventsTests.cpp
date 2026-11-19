// Controller ABI event publication and delivery through soundor:native.
#include "../support/Modules.h"
#include "js/Bindings.h"
#include "js/RustMethods.h"

#include <soundor/js/Context.h>
#include <soundor/js/Events.h>
#include <soundor/native/SoundorNative.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <atomic>
#include <bit>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace soundor;

namespace
{
    class Source final : private processor::ControllerServices
    {
    public:
        Source()
        {
            const processor::RustControllerFunctions functions {
                [](SoundorControllerInfo* info) -> std::int32_t
                {
                    *info = { sizeof(SoundorControllerInfo), SOUNDOR_CONTROLLER_ABI_VERSION,      1, 0,
                              native::controllerDescriptor,  sizeof(native::controllerDescriptor) };
                    return 0;
                },
                [](const SoundorControllerHost* controllerHost, void* instance) -> void*
                {
                    auto* self = static_cast<Source*>(instance);
                    self->host = *controllerHost;
                    return self;
                },
                [](void*) {},
                [](void*, std::uint32_t, const std::uint8_t*, std::size_t, SoundorWriter) -> std::int32_t { return 0; },
                [](void*, std::uint32_t, std::uint64_t, const std::uint8_t*, std::size_t, SoundorWriter) -> std::int32_t
                { return 0; },
                [](void*, std::uint64_t) {},
                [](void*, std::uint64_t*, SoundorWriter) -> std::int32_t { return 0; },
            };
            controller = std::make_shared<processor::RustController>(
                native::controllerDescriptor, functions, static_cast<processor::ControllerServices&>(*this), this);
            REQUIRE(controller->active());
        }

        ~Source() override { controller->shutdown(); }

        struct PresetLoaded
        {
            std::string path;
            std::optional<native::Preset> preset {};
        };

        bool presetLoaded(const PresetLoaded& event) const
        {
            std::vector<std::uint8_t> bytes;
            putString(bytes, event.path);
            bytes.push_back(event.preset.has_value() ? 1 : 0);
            if (event.preset.has_value())
            {
                putString(bytes, event.preset->name);
                putFloats(bytes, event.preset->gains);
            }
            return publish(1, bytes);
        }

        struct Levels
        {
            std::vector<float> values;
            native::Curve curve;
        };

        bool levels(const Levels& event) const
        {
            std::vector<std::uint8_t> bytes;
            putFloats(bytes, event.values);
            putU32(bytes, static_cast<std::uint32_t>(event.curve));
            return publish(0, bytes);
        }

        bool ready() const { return publish(2, {}); }
        auto statistics() const { return controller->eventSource().statistics(); }
        void install(js::Context& context) const
        {
            js::bind::connectRustEvents(context, controller);
            js::registerNativeModule(context, "soundor:native", { js::bind::installRustEvents, {}, {} });
        }

    private:
        SoundorControllerHost host {};
        std::shared_ptr<processor::RustController> controller;

        bool publish(std::uint32_t index, std::span<const std::uint8_t> bytes) const
        {
            return host.publishEvent(host.user, index, bytes.data(), bytes.size()) != 0;
        }

        static void putU32(std::vector<std::uint8_t>& bytes, std::uint32_t value)
        {
            for (int shift = 0; shift < 32; shift += 8)
                bytes.push_back(static_cast<std::uint8_t>(value >> shift));
        }

        static void putString(std::vector<std::uint8_t>& bytes, const std::string& value)
        {
            putU32(bytes, static_cast<std::uint32_t>(value.size()));
            bytes.insert(bytes.end(), value.begin(), value.end());
        }

        static void putFloats(std::vector<std::uint8_t>& bytes, std::span<const float> values)
        {
            putU32(bytes, static_cast<std::uint32_t>(values.size()));
            for (const float value : values)
                putU32(bytes, std::bit_cast<std::uint32_t>(value));
        }

        void wake() noexcept override {}
        double parameter(std::uint32_t) override { return 0; }
        void setParameter(std::uint32_t, double) override {}
        std::string state(std::uint32_t) override { return {}; }
        void setState(std::uint32_t, std::string_view) override {}
        bool history(HistoryAction) override { return false; }
        void loadPreset(std::string_view) override {}
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
        explicit Fixture(Source& source, const js::RuntimeOptions& options = {}) : runtime(options)
        {
            source.install(context);
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
        Source source;
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
        Source source;
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
        Source source;
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
        Source source;
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
        Source source;
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
        Source source;
        Fixture f(source, log.options());
        f.run("globalThis.paths = []; events.presetLoaded.subscribe((e) => paths.push(e.path));");
        constexpr int capacity = 1024;
        for (int index = 0; index < capacity + 2; ++index)
            CHECK(source.presetLoaded({ .path = std::to_string(index) }) == (index < capacity));
        CHECK(source.statistics().dropped == 2);
        CHECK(js::deliverEvents(f.context) == capacity);
        CHECK(f.text("paths[paths.length - 1]") == "1023");
        REQUIRE(log.warnings.size() == 1);
        CHECK(log.warnings[0]
              == "soundor:native: 2 events were dropped: the UI did not take them in time (it holds 1024)");
        // Delivering made room again.
        CHECK(source.presetLoaded({ .path = "5" }));
        js::deliverEvents(f.context);
        CHECK(f.text("paths[paths.length - 1]") == "5");
        CHECK(log.warnings.size() == 1);
    }

    TEST_CASE("without a connected context, events are dropped")
    {
        Source source;
        CHECK_FALSE(source.ready());
        CHECK(source.statistics().published == 1);
        CHECK(source.statistics().dropped == 1);
    }

    TEST_CASE("events published before the module is imported are not kept")
    {
        Source source;
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
        Source source;
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
        Source source;
        Fixture f(source);
        f.run("globalThis.paths = []; events.presetLoaded.subscribe((e) => paths.push(e.path));");
        constexpr int threads = 4;
        constexpr int perThread = 250;
        std::atomic<int> finished = 0;
        std::vector<std::thread> producers;
        producers.reserve(threads);
        for (int thread = 0; thread < threads; ++thread)
            producers.emplace_back(
                [&source, &finished, thread]
                {
                    for (int index = 0; index < perThread; ++index)
                        source.presetLoaded({ .path = std::to_string(thread) + ":" + std::to_string(index) });
                    ++finished;
                });
        // Delivering while they publish.
        constexpr std::size_t total = std::size_t { threads } * perThread;
        std::size_t delivered = 0;
        while (finished.load() < threads)
        {
            delivered += js::deliverEvents(f.context);
            std::this_thread::yield();
        }
        for (auto& producer : producers)
            producer.join();
        delivered += js::deliverEvents(f.context);
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
        Source source;
        {
            Fixture f(source);
            f.run("events.ready.subscribe(() => {});");
            source.ready();
            // Destroyed with an event undelivered.
        }
        CHECK_FALSE(source.ready());

        auto early = std::make_unique<Source>();
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
        Source source;
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
        Source source;
        RuntimeHost::Options options;
        options.installModules = [&source](js::Context& context) { source.install(context); };
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
