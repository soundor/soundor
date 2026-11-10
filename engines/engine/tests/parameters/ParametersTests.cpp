#include "../support/Modules.h"

#include <soundor/js/Context.h>
#include <soundor/parameters/Parameters.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

using namespace soundor;
using js::Value;
using parameters::Access;
using parameters::Type;

namespace
{
    std::vector<parameters::Info> fixtureInfos()
    {
        return {
            { "bypass", "Bypass", Type::Boolean, Access::Automatable, 0, 1, 0, 0, "", {} },
            { "gain", "Gain", Type::Float32, Access::Automatable, -60, 6, 0, 0.5, "dB", {} },
            { "lowCut", "Low cut", Type::Float32, Access::Manual, 20, 400, 20, 0, "Hz", {} },
            { "mode",
              "Mode",
              Type::Choice,
              Access::Automatable,
              0,
              2,
              1,
              0,
              "",
              { { "mono", "Mono" }, { "stereo", "Stereo" }, { "midSide", "Mid/Side" } } },
            { "voices", "Voices", Type::Int32, Access::Automatable, 1, 16, 4, 0, "", {} },
            { "reduction", "Reduction", Type::Float32, Access::ReadOnly, -60, 0, 0, 0, "dB", {} },
        };
    }

    // A parameter system in memory, standing in for a backend (JUCE's APVTS).
    class FakeHost final : public parameters::Host
    {
    public:
        FakeHost() : declared(fixtureInfos()), values(declared.size()), flags(declared.size())
        {
            for (std::size_t i = 0; i < declared.size(); ++i)
                values[i] = declared[i].defaultValue;
        }

        [[nodiscard]] std::span<const parameters::Info> infos() const override { return declared; }
        [[nodiscard]] double value(std::size_t index) const override { return values[index]; }

        void setValue(std::size_t index, double value) override
        {
            log.push_back("set " + declared[index].id + " " + Value::number(value).toString());
            values[index] = value;
            flags.markChanged(index);
        }

        void beginGesture(std::size_t index) override { log.push_back("begin " + declared[index].id); }
        void endGesture(std::size_t index) override { log.push_back("end " + declared[index].id); }
        parameters::ChangeFlags& changes() override { return flags; }

        // Stand-ins for the backend's generated behavior: linear, stepped by
        // `step` (by 1 for integers and choices).
        [[nodiscard]] double constrain(std::size_t index, double value) const override
        {
            const auto& info = declared[index];
            if (info.type == Type::Boolean)
                return value >= 0.5 ? 1 : 0;
            const double grain = info.type == Type::Float32 ? info.step : 1;
            const double clamped = std::clamp(value, info.min, info.max);
            return grain > 0 ? info.min + std::round((clamped - info.min) / grain) * grain : clamped;
        }
        [[nodiscard]] double toNormalized(std::size_t index, double value) const override
        {
            const auto& info = declared[index];
            return (value - info.min) / (info.max - info.min);
        }
        [[nodiscard]] double fromNormalized(std::size_t index, double normalized) const override
        {
            const auto& info = declared[index];
            return constrain(index, info.min + std::clamp(normalized, 0.0, 1.0) * (info.max - info.min));
        }
        [[nodiscard]] std::string format(std::size_t index, double value) const override
        {
            const auto& info = declared[index];
            if (info.type == Type::Choice)
                return info.choices[static_cast<std::size_t>(value)].label;
            return Value::number(value).toString() + (info.unit.empty() ? "" : " " + info.unit);
        }
        [[nodiscard]] std::optional<double> parse(std::size_t index, std::string_view text) const override
        {
            if (text == "nope")
                return std::nullopt;
            return constrain(index, std::stod(std::string(text)));
        }

        // A change from outside the UI, e.g. host automation on the audio thread.
        void automate(std::size_t index, double value)
        {
            values[index] = value;
            flags.markChanged(index);
        }

        std::vector<parameters::Info> declared;
        std::vector<double> values;
        parameters::ChangeFlags flags;
        std::vector<std::string> log;
    };

    struct Fixture
    {
        Fixture() { parameters::install(context, host); }

        Value value(const std::string& body)
        {
            auto evaluated = context.evaluateModule(
                soundor::test::module("import { parameters as p } from 'soundor:parameters';\n" + body),
                "/t" + std::to_string(++counter) + ".js");
            REQUIRE_MESSAGE(evaluated.ok(), (evaluated.ok() ? "" : evaluated.error().toString()));
            return context.evaluateScript("globalThis.result").value();
        }

        std::string error(const std::string& body)
        {
            auto evaluated = context.evaluateModule(
                soundor::test::module("import { parameters as p } from 'soundor:parameters';\n" + body),
                "/t" + std::to_string(++counter) + ".js");
            REQUIRE_FALSE(evaluated.ok());
            return evaluated.error().toString();
        }

        std::vector<std::string> messages;
        js::Runtime runtime { js::RuntimeOptions { .log = [this](js::LogLevel, std::string_view message)
                                                   { messages.emplace_back(message); } } };
        js::Context context { runtime };
        std::shared_ptr<FakeHost> host = std::make_shared<FakeHost>();
        int counter = 0;
    };
} // namespace

TEST_SUITE("soundor:parameters")
{
    TEST_CASE("exposes every parameter by id with its declared metadata")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = Object.keys(p).join(',');").asString()
              == "bypass,gain,lowCut,mode,voices,reduction");
        CHECK(
            f.value("globalThis.result = JSON.stringify(p.gain.info);").asString()
            == R"({"id":"gain","label":"Gain","access":"automatable","type":"float32","min":-60,"max":6,"default":0,"step":0.5,"unit":"dB"})");
        CHECK(f.value("globalThis.result = JSON.stringify(p.voices.info);").asString()
              == R"({"id":"voices","label":"Voices","access":"automatable","type":"int32","min":1,"max":16,"default":4})");
        CHECK(f.value("globalThis.result = JSON.stringify(p.bypass.info);").asString()
              == R"({"id":"bypass","label":"Bypass","access":"automatable","type":"boolean","default":false})");
        CHECK(
            f.value("globalThis.result = JSON.stringify(p.mode.info);").asString()
            == R"({"id":"mode","label":"Mode","access":"automatable","type":"choice","options":[{"value":"mono","label":"Mono"},{"value":"stereo","label":"Stereo"},{"value":"midSide","label":"Mid/Side"}],"default":"stereo"})");
        CHECK(f.value("globalThis.result = p.lowCut.info.access + ' ' + p.reduction.info.access;").asString()
              == "manual readOnly");
    }

    TEST_CASE("parameters and their metadata are immutable")
    {
        Fixture f;
        CHECK(f.value("'use strict'; try { p.gain.info.min = 0; globalThis.result = 'mutated'; }"
                      "catch (e) { globalThis.result = e.name; }")
                  .asString()
              == "TypeError");
        CHECK(f.value("try { p.extra = 1; } catch {} globalThis.result = 'extra' in p;").asBoolean() == false);
        CHECK(f.value("try { p.gain.set = null; } catch {} globalThis.result = typeof p.gain.set;").asString()
              == "function");
    }

    TEST_CASE("reads values in their declared JavaScript types")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = p.gain.get();").asNumber() == 0);
        CHECK(f.value("globalThis.result = p.voices.get();").asNumber() == 4);
        CHECK(f.value("globalThis.result = p.bypass.get();") == Value::boolean(false));
        CHECK(f.value("globalThis.result = p.mode.get();").asString() == "stereo");
        f.host->values[3] = 2;
        f.host->values[0] = 1;
        CHECK(f.value("globalThis.result = p.mode.get() + ' ' + p.bypass.get();").asString() == "midSide true");
    }

    TEST_CASE("sets values, converting to plain units and constraining them as the host does")
    {
        Fixture f;
        REQUIRE(f.value("p.gain.set(-12.4); p.bypass.set(true); p.mode.set('mono');"
                        "p.voices.set(7.6); p.gain.set(100); p.lowCut.set(-5); globalThis.result = 0;")
                    .isNumber());
        CHECK(f.host->log
              == std::vector<std::string> { "set gain -12.5", "set bypass 1", "set mode 0", "set voices 8",
                                            "set gain 6", "set lowCut 20" });
        CHECK(f.value("globalThis.result = p.gain.get();").asNumber() == 6);
    }

    TEST_CASE("rejects values of the wrong type without touching the host")
    {
        Fixture f;
        CHECK(f.error("p.gain.set('loud');") == "TypeError: Parameter 'gain' expects a number, got 'loud'");
        CHECK(f.error("p.gain.set(NaN);") == "TypeError: Parameter 'gain' expects a number, got NaN");
        CHECK(f.error("p.bypass.set(1);") == "TypeError: Parameter 'bypass' expects a boolean, got 1");
        CHECK(f.error("p.mode.set('quad');")
              == "TypeError: Parameter 'mode' expects one of 'mono', 'stereo', 'midSide', got 'quad'");
        CHECK(f.host->log.empty());
    }

    TEST_CASE("a read-only parameter is the processing's: the UI reads it, never writes it")
    {
        Fixture f;
        CHECK(f.error("p.reduction.set(-3);")
              == "TypeError: Parameter 'reduction' is read-only: only the plugin's processing sets it");
        CHECK(f.error("p.reduction.beginGesture();")
              == "TypeError: Parameter 'reduction' is read-only: only the plugin's processing sets it");
        REQUIRE(f.value("p.reduction.endGesture(); globalThis.result = 0;").isNumber());
        f.host->automate(5, -6);
        CHECK(f.value("globalThis.result = p.reduction.get() + ' ' + p.reduction.format();").asString() == "-6 -6 dB");
        CHECK(f.host->log.empty());
        // A manual parameter is the UI's to set; only automation is out.
        REQUIRE(f.value("p.lowCut.set(100); globalThis.result = 0;").isNumber());
        CHECK(f.host->log == std::vector<std::string> { "set lowCut 100" });
    }

    TEST_CASE("formats, parses and maps through the host's behavior, in declared types")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = p.gain.format();").asString() == "0 dB");
        CHECK(f.value("globalThis.result = p.gain.format(-3.3);").asString() == "-3.5 dB");
        CHECK(f.value("globalThis.result = p.mode.format('midSide');").asString() == "Mid/Side");
        CHECK(f.value("globalThis.result = p.gain.parse('-12');").asNumber() == -12);
        CHECK(f.value("globalThis.result = p.gain.parse('nope');").isNull());
        CHECK(f.value("globalThis.result = p.mode.parse('2');").asString() == "midSide");
        CHECK(f.value("globalThis.result = p.bypass.parse('1');") == Value::boolean(true));
        CHECK(f.value("globalThis.result = p.gain.toNormalized(-27);").asNumber() == 0.5);
        CHECK(f.value("globalThis.result = p.gain.toNormalized();").asNumber() == 60.0 / 66.0);
        CHECK(f.value("globalThis.result = p.voices.fromNormalized(1);").asNumber() == 16);
        CHECK(f.value("globalThis.result = p.mode.fromNormalized(0.5);").asString() == "stereo");
        CHECK(f.value("globalThis.result = p.bypass.fromNormalized(0.9);") == Value::boolean(true));
        CHECK(f.error("p.gain.parse(1);") == "TypeError: Parameter 'gain': parse() expects a string, got 1");
        CHECK(f.error("p.gain.fromNormalized(NaN);")
              == "TypeError: Parameter 'gain': fromNormalized() expects a number, got NaN");
        CHECK(f.error("p.mode.format('quad');")
              == "TypeError: Parameter 'mode' expects one of 'mono', 'stereo', 'midSide', got 'quad'");
        CHECK(f.host->log.empty());
    }

    TEST_CASE("notifies subscribers of changes from any source, converted")
    {
        Fixture f;
        REQUIRE(f.value("globalThis.events = [];"
                        "p.gain.subscribe((v) => events.push('gain ' + v));"
                        "p.mode.subscribe((v) => events.push('mode ' + v));"
                        "p.bypass.subscribe((v) => events.push('bypass ' + v));"
                        "globalThis.result = 0;")
                    .isNumber());
        f.host->automate(1, -3); // host automation
        f.host->automate(3, 2);  // e.g. a preset load
        CHECK(parameters::dispatchChanges(f.context) == 2);
        REQUIRE(f.value("p.bypass.set(true); globalThis.result = 0;").isNumber()); // the UI itself
        CHECK(parameters::dispatchChanges(f.context) == 1);
        CHECK(f.context.evaluateScript("events.join('|')").value().asString() == "gain -3|mode midSide|bypass true");
    }

    TEST_CASE("coalesces repeated changes into one notification per dispatch")
    {
        Fixture f;
        REQUIRE(
            f.value("globalThis.seen = []; p.gain.subscribe((v) => seen.push(v)); globalThis.result = 0;").isNumber());
        for (int i = 1; i <= 50; ++i)
            f.host->automate(1, -double(i));
        CHECK(parameters::dispatchChanges(f.context) == 1);
        CHECK(parameters::dispatchChanges(f.context) == 0);
        CHECK(f.context.evaluateScript("seen.join(',')").value().asString() == "-50");
    }

    TEST_CASE("changes can be marked from another thread")
    {
        Fixture f;
        REQUIRE(f.value("globalThis.count = 0; p.gain.subscribe(() => count++); globalThis.result = 0;").isNumber());
        std::thread audio(
            [&]
            {
                for (int i = 0; i < 10000; ++i)
                    f.host->flags.markChanged(1);
            });
        while (! audio.joinable())
            std::this_thread::yield();
        for (int i = 0; i < 100; ++i)
            parameters::dispatchChanges(f.context);
        audio.join();
        parameters::dispatchChanges(f.context);
        const double count = f.context.evaluateScript("count").value().asNumber();
        CHECK(count >= 1);
        CHECK(count <= 101);
        CHECK(parameters::dispatchChanges(f.context) == 0);
    }

    TEST_CASE("unsubscribing stops notifications and is idempotent")
    {
        Fixture f;
        REQUIRE(f.value("globalThis.calls = 0; const listener = () => calls++;"
                        "globalThis.a = p.gain.subscribe(listener); globalThis.b = p.gain.subscribe(listener);"
                        "globalThis.result = 0;")
                    .isNumber());
        f.host->automate(1, -1);
        parameters::dispatchChanges(f.context);
        CHECK(f.context.evaluateScript("calls").value().asNumber() == 2);
        REQUIRE(f.context.evaluateScript("a(); a();").ok());
        f.host->automate(1, -2);
        parameters::dispatchChanges(f.context);
        CHECK(f.context.evaluateScript("calls").value().asNumber() == 3);
        REQUIRE(f.context.evaluateScript("b();").ok());
        f.host->automate(1, -3);
        parameters::dispatchChanges(f.context);
        CHECK(f.context.evaluateScript("calls").value().asNumber() == 3);
    }

    TEST_CASE("a throwing subscriber is reported and does not stop the others")
    {
        Fixture f;
        REQUIRE(f.value("globalThis.reached = false;"
                        "p.gain.subscribe(() => { throw new Error('broken listener'); });"
                        "p.gain.subscribe(() => { reached = true; }); globalThis.result = 0;")
                    .isNumber());
        f.host->automate(1, -1);
        parameters::dispatchChanges(f.context);
        CHECK(f.context.evaluateScript("reached").value().asBoolean());
        REQUIRE(f.messages.size() == 1);
        CHECK(f.messages[0].find("soundor:parameters subscriber threw: Error: broken listener") == 0);
    }

    TEST_CASE("subscribe validates its listener")
    {
        Fixture f;
        CHECK(f.error("p.gain.subscribe(42);") == "TypeError: Parameter 'gain': subscribe() expects a function");
    }

    TEST_CASE("forwards gestures, balancing nested and unmatched calls")
    {
        Fixture f;
        REQUIRE(f.value("p.gain.beginGesture(); p.gain.beginGesture(); p.gain.set(-1);"
                        "p.gain.endGesture(); p.gain.endGesture(); p.gain.endGesture();"
                        "p.mode.endGesture(); globalThis.result = 0;")
                    .isNumber());
        CHECK(f.host->log == std::vector<std::string> { "begin gain", "set gain -1", "end gain" });
    }

    TEST_CASE("a gesture left open when the runtime goes away is ended")
    {
        auto host = std::make_shared<FakeHost>();
        {
            js::Runtime runtime;
            js::Context context(runtime);
            parameters::install(context, host);
            REQUIRE(context
                        .evaluateModule(soundor::test::module("import { parameters } from 'soundor:parameters';"
                                                              "parameters.voices.beginGesture();"),
                                        "/drag.js")
                        .ok());
        }
        CHECK(host->log == std::vector<std::string> { "begin voices", "end voices" });
    }

    TEST_CASE("the internal module is private to the runtime")
    {
        Fixture f;
        auto result = f.context.evaluateModule(
            soundor::test::module("import { set } from 'soundor:internal/parameters';"), "/evil.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().toString()
              == "TypeError: Cannot import 'soundor:internal/parameters': it is internal to the Soundor runtime");
        auto dynamic = f.context.evaluateModule(soundor::test::module("await import('soundor:internal/parameters');"),
                                                "/evil2.js");
        REQUIRE_FALSE(dynamic.ok());
    }

    TEST_CASE("dispatching before anything imported the module is harmless")
    {
        Fixture f;
        f.host->automate(1, -1);
        CHECK(parameters::dispatchChanges(f.context) == 1);
        CHECK(f.value("globalThis.result = p.gain.get();").asNumber() == -1);
    }
}

TEST_SUITE("RuntimeHost")
{
    TEST_CASE("installs modules and delivers parameter changes on tick")
    {
        auto host = std::make_shared<FakeHost>();
        bool customInstalled = false;
        RuntimeHost runtimeHost(
            { .parameters = host, .installModules = [&](js::Context&) { customInstalled = true; } });
        CHECK(customInstalled);
        REQUIRE(
            runtimeHost.context()
                .evaluateModule(soundor::test::module(
                                    "import { parameters } from 'soundor:parameters';"
                                    "globalThis.seen = [];"
                                    "parameters.gain.subscribe((v) => Promise.resolve(v).then((x) => seen.push(x)));"),
                                "/ui.js")
                .ok());
        host->automate(1, -7);
        runtimeHost.tick(); // dispatch, then run the promise job the subscriber queued
        CHECK(runtimeHost.context().evaluateScript("seen.join()").value().asString() == "-7");
    }

    TEST_CASE("repeated reloads leave nothing behind")
    {
        auto host = std::make_shared<FakeHost>();
        for (int reload = 0; reload < 100; ++reload)
        {
            RuntimeHost runtimeHost({ .parameters = host });
            REQUIRE(runtimeHost.context()
                        .evaluateModule(
                            soundor::test::module("import { parameters } from 'soundor:parameters';"
                                                  "for (const p of Object.values(parameters)) p.subscribe(() => {});"
                                                  "parameters.gain.beginGesture();"),
                            "/ui.js")
                        .ok());
            host->automate(1, -double(reload));
            runtimeHost.tick();
        }
        // Each reload ended its own open gesture; nothing else reached the host.
        CHECK(host->log.size() == 200);
        CHECK(host.use_count() == 1);
    }
}
