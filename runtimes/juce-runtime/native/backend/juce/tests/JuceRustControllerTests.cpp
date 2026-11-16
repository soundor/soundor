// The engine's Rust controller bridge (processor::RustController and the
// generic soundor:native bindings), linked to a real Rust controller (tests/rust,
// built with Cargo against the SDK's fixture contract): JavaScript calling
// Rust through Hermes, the engine and the C ABI, async methods polled on the
// controller's worker and settled when it is pumped, and a resource the
// controller publishes reaching the Rust processor's next block.

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN

#include "js/Bindings.h"
#include "js/RustMethods.h"
#include "support/Modules.h"

#include <soundor/js/Context.h>
#include <soundor/processor/RustController.h>
#include <soundor/processor/RustProcessor.h>

#include <doctest/doctest.h>

#include <array>
#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace bind = soundor::js::bind;
namespace js = soundor::js;
namespace processor = soundor::processor;
using soundor::js::Value;

namespace
{
    // The fixture's: parameters gain, bypass, mode, steps, peak (read-only);
    // streams history, level; an 80-byte state snapshot.
    constexpr processor::RustContract contract { 5, 1, 2, 80 };

    // The descriptor the linked controller reports: what the runtime's
    // generated code would hold for the same config.
    std::span<const std::uint8_t> linkedDescriptor()
    {
        SoundorControllerInfo info {};
        REQUIRE(soundor_controller_info(&info) == 0);
        return { info.descriptor, info.descriptorSize };
    }

    // A runtime's services: plain values, by index.
    struct Services final : processor::ControllerServices
    {
        explicit Services(const processor::ControllerContract& contract)
        {
            for (const auto& field : contract.state)
                names.push_back(field.name);
            values = { { "processingMode", "1" }, { "selectedPreset", "null" }, { "tags", "[]" } };
        }

        void wake() noexcept override { woken.store(true); }
        double parameter(std::uint32_t index) override { return parameters.at(index); }
        void setParameter(std::uint32_t index, double plain) override { parameters.at(index) = plain; }
        std::string state(std::uint32_t index) override { return values.at(names.at(index)); }
        void setState(std::uint32_t index, std::string_view json) override
        {
            if (names.at(index) == "tags" && json.size() > 40)
                throw std::invalid_argument("at most 4 elements");
            values[names.at(index)] = std::string(json);
        }
        bool history(HistoryAction) override { return false; }
        void loadPreset(std::string_view id) override
        {
            if (id != "warm")
                throw std::invalid_argument("Unknown factory preset");
        }

        std::atomic<bool> woken { false };
        std::array<double, 5> parameters { 1.0, 0.0, 1.0, 0.0, -96.0 };
        std::vector<std::string> names;
        std::map<std::string, std::string, std::less<>> values;
    };

    const char controllerKey = 0;

    struct Fixture
    {
        explicit Fixture(void* processorHandle = nullptr)
            : controller(std::make_shared<processor::RustController>(
                  linkedDescriptor(), processor::linkedRustController(), services, processorHandle))
        {
            bind::setRustController(*context, &controllerKey, controller);
            js::registerNativeModule(*context, "soundor:native",
                                     { [](bind::ContextState& ctx, soundor::jsi::Object& exports)
                                       { bind::installRustMethods(ctx, exports, &controllerKey); },
                                       {},
                                       {} });
        }

        Value value(const std::string& body)
        {
            auto evaluated =
                context->evaluateModule(soundor::test::module("import * as n from 'soundor:native';\n" + body),
                                        "/test" + std::to_string(++counter) + ".js");
            REQUIRE_MESSAGE(evaluated.ok(), (evaluated.ok() ? "" : evaluated.error().toString()));
            return context->evaluateScript("globalThis.result").value();
        }

        // Pumps the controller when it asks, as the runtime's AsyncUpdater
        // does, until `done` is true in JavaScript.
        Value await(const std::string& done)
        {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
            for (;;)
            {
                if (services.woken.exchange(false))
                    controller->pump();
                const auto finished = context->evaluateScript(done);
                REQUIRE(finished.ok());
                if (finished.value().asBoolean())
                    return context->evaluateScript("globalThis.result").value();
                REQUIRE(std::chrono::steady_clock::now() < deadline);
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }

        processor::ControllerContract described =
            processor::ControllerContract::parse(linkedDescriptor()).value_or(processor::ControllerContract {});
        Services services { described };
        std::shared_ptr<processor::RustController> controller;
        js::Runtime runtime;
        std::unique_ptr<js::Context> context = std::make_unique<js::Context>(runtime);
        int counter = 0;
    };

    struct RecordedStreams
    {
        std::array<float, 8> history {};
        std::uint32_t length = 0;

        SoundorStreamSink sink()
        {
            return { this, [](void*, std::uint32_t, double) {},
                     [](void* user, std::uint32_t index, std::uint32_t* capacity) -> void*
                     {
                         *capacity = index == 0 ? 8 : 0;
                         return index == 0 ? static_cast<RecordedStreams*>(user)->history.data() : nullptr;
                     },
                     [](void* user, std::uint32_t, std::uint32_t length)
                     { static_cast<RecordedStreams*>(user)->length = length; } };
        }
    };
} // namespace

TEST_CASE("the linked crate exports a controller of the same contract, which runs")
{
    Fixture f;
    CHECK(f.controller->present());
    CHECK(f.controller->active());
    CHECK(f.controller->error().empty());
    CHECK(f.controller->contract().methods.size() == 8);
}

TEST_CASE("JavaScript calls synchronous Rust methods, the local store kept between calls")
{
    Fixture f;
    CHECK(f.value("globalThis.result = n.increment() + n.increment() * 10;").asNumber() == 21);
    CHECK(f.value("globalThis.result = n.describe(1.5, 18446744073709551615n, ['a', 'b']);").asString()
          == "18446744073709551615: 1.5 [a,b] 1");
    // Through the runtime's services.
    CHECK(f.services.parameters[0] == 1.5);
    CHECK(f.services.values["tags"] == R"(["a","b"])");
    CHECK(f.value("globalThis.result = JSON.stringify(n.analyze(new Float32Array([0.5, -2])));").asString()
          == R"({"peak":2,"points":[{"x":2,"y":0}],"label":null})");
    CHECK(f.value("globalThis.result = n.pick(null) + ',' + n.pick('linear');").asString() == "ease-in,linear");
    CHECK(f.value("n.reset(); globalThis.result = n.increment();").asNumber() == 1);
}

TEST_CASE("a refused state value and a bad argument are JavaScript errors")
{
    Fixture f;
    auto refused = f.context->evaluateModule(
        soundor::test::module("import * as n from 'soundor:native';\n"
                              "n.describe(1, 1n, ['a long tag', 'another long tag', 'and a third one']);"),
        "/refused.js");
    REQUIRE_FALSE(refused.ok());
    CHECK(refused.error().toString().find("describe(): the controller panicked: state.tags: at most 4 elements")
          != std::string::npos);
    auto mistyped = f.context->evaluateModule(
        soundor::test::module("import * as n from 'soundor:native';\nn.describe('1', 1n, []);"), "/mistyped.js");
    REQUIRE_FALSE(mistyped.ok());
    CHECK(mistyped.error().toString() == "TypeError: describe(): gain: expected float32, got string");
}

TEST_CASE("async Rust methods return promises, run on the worker, schedule onto the control thread")
{
    Fixture f;
    f.value("globalThis.done = false; n.increment();"
            "n.incrementLater().then((value) => { globalThis.result = value; globalThis.done = true; });");
    CHECK(f.await("globalThis.done").asNumber() == 2);
    f.value("globalThis.done = false;"
            "n.fail('no table').catch((error) => { globalThis.result = String(error); globalThis.done = true; });");
    CHECK(f.await("globalThis.done").asString() == "Error: fail(): no table");
}

TEST_CASE("a resource an async method publishes reaches the processor's next block")
{
    processor::RustProcessor rust(contract, processor::linkedRustProcessor());
    REQUIRE(rust.valid());
    Fixture f(rust.nativeHandle());
    processor::RustBusLayout layout { { { 0, 1 }, {} }, { { 0, 1 } } };
    const std::vector<double> parameters { 1, 0, 1, 0, -96 };
    REQUIRE(rust.prepare(48000, 128, layout, parameters) == SOUNDOR_STATUS_OK);
    std::vector<float> left(64), right(64);
    std::array<float*, 2> channels { left.data(), right.data() };
    std::vector<double> published(1);
    RecordedStreams streams;
    const auto sink = streams.sink();
    rust.process(channels, 64, parameters, published, processor::unknownTransport(), &sink);
    // prepare's own: one element a frame.
    CHECK(streams.history[4] == 128.0F);

    f.value("globalThis.done = false;"
            "n.loadTable(300).then((table) => { globalThis.result = table.length; globalThis.done = true; });");
    CHECK(f.await("globalThis.done").asNumber() == 300);
    CHECK(f.services.values["selectedPreset"] == R"("table 300")");
    rust.process(channels, 64, parameters, published, processor::unknownTransport(), &sink);
    CHECK(streams.history[4] == 300.0F);
}

TEST_CASE("plugin instances' controllers are independent")
{
    Fixture first;
    Fixture second;
    first.value("n.increment(); n.increment();");
    CHECK(second.value("globalThis.result = n.increment();").asNumber() == 1);
    CHECK(first.value("globalThis.result = n.increment();").asNumber() == 3);
}

TEST_CASE("closing an editor keeps the controller; shutting down with work in flight is clean")
{
    Fixture f;
    f.value("n.increment(); n.incrementLater(); n.loadTable(1 << 20);");
    // The editor's context goes: what it started is cancelled.
    f.context.reset();
    f.context = std::make_unique<js::Context>(f.runtime);
    bind::setRustController(*f.context, &controllerKey, f.controller);
    js::registerNativeModule(*f.context, "soundor:native",
                             { [](bind::ContextState& ctx, soundor::jsi::Object& exports)
                               { bind::installRustMethods(ctx, exports, &controllerKey); },
                               {},
                               {} });
    // The local store outlived it.
    CHECK(f.value("globalThis.result = n.increment();").asNumber() >= 2);
    f.value("n.incrementLater(); n.loadTable(4096);");
    f.controller->shutdown();
    CHECK_FALSE(f.controller->active());
    f.runtime.runPendingJobs();
}
