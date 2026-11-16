// processor::RustController and the generic `soundor:native` bindings it
// backs (js/RustMethods.h), through the generated installController() of the
// soundor:native fixture (tests/generated, from src/native-codegen.test.ts),
// on a C++ controller that keeps the controller ABI's rules
// (RustControllerAbi.h) behind its function table: the engine's own work
// without a Rust library. The JUCE runtime's JuceRustControllerTests.cpp runs
// the same on a real Rust controller.

#include "../support/Modules.h"

#include <soundor/js/Context.h>
#include <soundor/native/SoundorNative.h>
#include <soundor/processor/RustController.h>

#include <doctest/doctest.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <deque>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using namespace soundor;
using js::Value;
using processor::ControllerContract;
using processor::RustController;

namespace
{
    std::span<const std::uint8_t> descriptor()
    {
        return native::controllerDescriptor;
    }

    // What the fake ABI's info reports.
    struct Exported
    {
        bool present = true;
        std::uint32_t abiVersion = SOUNDOR_CONTROLLER_ABI_VERSION;
        std::vector<std::uint8_t> descriptor { native::controllerDescriptor,
                                               native::controllerDescriptor + sizeof native::controllerDescriptor };
    };
    Exported& exported()
    {
        static Exported value;
        return value;
    }

    void send(SoundorWriter writer, const void* data, std::size_t length)
    {
        writer.write(writer.user, static_cast<const std::uint8_t*>(data), length);
    }

    void send(SoundorWriter writer, std::string_view text)
    {
        send(writer, text.data(), text.size());
    }

    template <typename T>
    void put(std::vector<std::uint8_t>& out, T value)
    {
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(&value);
        out.insert(out.end(), bytes, bytes + sizeof value);
    }

    void putString(std::vector<std::uint8_t>& out, std::string_view text)
    {
        put(out, static_cast<std::uint32_t>(text.size()));
        out.insert(out.end(), text.begin(), text.end());
    }

    std::string takeString(const std::uint8_t* args, std::size_t length)
    {
        std::uint32_t size = 0;
        REQUIRE(length >= 4);
        std::memcpy(&size, args, 4);
        REQUIRE(length == 4 + size);
        return { reinterpret_cast<const char*>(args) + 4, size };
    }

    // A controller keeping the ABI's rules, whose methods echo or compute.
    struct Fake
    {
        struct Item
        {
            std::uint64_t operation = 0; // 0: a scheduled task
            bool ok = true;
            std::vector<std::uint8_t> bytes;
        };

        SoundorControllerHost host {};
        ControllerContract contract;
        std::deque<Item> queue;
        std::set<std::uint64_t> waiting;
        std::vector<std::uint64_t> cancelled;
        int tasks = 0;
        bool hadProcessor = false;

        [[nodiscard]] const std::string& name(std::uint32_t method) const { return contract.methods.at(method).name; }
    };

    int destroyed = 0;
    Fake* last = nullptr;

    Fake& fake(void* handle)
    {
        return *static_cast<Fake*>(handle);
    }

    std::int32_t fakeInfo(SoundorControllerInfo* info)
    {
        *info = { sizeof(SoundorControllerInfo), exported().abiVersion,       exported().present ? 1U : 0U, 30,
                  exported().descriptor.data(),  exported().descriptor.size() };
        return 0;
    }

    void* fakeCreate(const SoundorControllerHost* host, void* processor)
    {
        auto* created = new Fake;
        created->host = *host;
        if (auto parsed = ControllerContract::parse(descriptor()))
            created->contract = std::move(*parsed);
        created->hadProcessor = processor != nullptr;
        last = created;
        return created;
    }

    void fakeDestroy(void* handle)
    {
        ++destroyed;
        if (last == handle)
            last = nullptr;
        delete static_cast<Fake*>(handle);
    }

    std::int32_t fakeCall(void* handle, std::uint32_t method, const std::uint8_t* args, std::size_t length,
                          SoundorWriter out)
    {
        Fake& self = fake(handle);
        const std::string& name = self.name(method);
        if (self.contract.methods.at(method).async)
        {
            send(out, "called as the other kind of method");
            return SOUNDOR_CONTROLLER_INVALID;
        }
        // The echoes return their argument: what JavaScript passed, converted
        // there and back.
        if (name.starts_with("echo") || name == "invert")
        {
            send(out, args, length);
            return SOUNDOR_CONTROLLER_OK;
        }
        if (name == "add")
        {
            REQUIRE(length == 8);
            std::int32_t a = 0, b = 0;
            std::memcpy(&a, args, 4);
            std::memcpy(&b, args + 4, 4);
            const std::int32_t sum = a + b;
            send(out, &sum, sizeof sum);
            return SOUNDOR_CONTROLLER_OK;
        }
        if (name == "greet")
        {
            std::vector<std::uint8_t> result;
            putString(result, "hello " + takeString(args, length));
            send(out, result.data(), result.size());
            return SOUNDOR_CONTROLLER_OK;
        }
        if (name == "fail")
        {
            send(out, takeString(args, length));
            return SOUNDOR_CONTROLLER_FAILED;
        }
        if (name == "reset")
        {
            // A task's services, through the host's callbacks.
            const auto& host = self.host;
            if (host.parameterSet(host.user, 1, 0.25) != 0)
            {
                send(out, "the parameter was refused");
                return SOUNDOR_CONTROLLER_FAILED;
            }
            const std::string json = R"("too long for this field")";
            std::vector<std::uint8_t> error;
            SoundorWriter collect { &error, [](void* user, const std::uint8_t* data, std::size_t size)
                                    {
                                        static_cast<std::vector<std::uint8_t>*>(user)->insert(
                                            static_cast<std::vector<std::uint8_t>*>(user)->end(), data, data + size);
                                    } };
            if (host.stateSet(host.user, 0, reinterpret_cast<const std::uint8_t*>(json.data()), json.size(), collect)
                != 0)
            {
                send(out, error.data(), error.size());
                return SOUNDOR_CONTROLLER_FAILED;
            }
            return SOUNDOR_CONTROLLER_OK;
        }
        if (name == "isEven")
        {
            REQUIRE(length == 4);
            std::int32_t value = 0;
            std::memcpy(&value, args, 4);
            const std::uint8_t even = value % 2 == 0 ? 1 : 0;
            send(out, &even, 1);
            return SOUNDOR_CONTROLLER_OK;
        }
        if (name == "solo")
        {
            const std::uint8_t malformed[] = { 7 };
            send(out, malformed, 1);
            return SOUNDOR_CONTROLLER_OK;
        }
        send(out, "not faked");
        return SOUNDOR_CONTROLLER_INVALID;
    }

    std::int32_t fakeStart(void* handle, std::uint32_t method, std::uint64_t operation, const std::uint8_t* args,
                           std::size_t length, SoundorWriter error)
    {
        Fake& self = fake(handle);
        const std::string& name = self.name(method);
        if (! self.contract.methods.at(method).async)
        {
            send(error, "called as the other kind of method");
            return SOUNDOR_CONTROLLER_INVALID;
        }
        Fake::Item item;
        item.operation = operation;
        if (name == "save")
        {
            // Resolves with nothing.
        }
        else if (name == "loadPreset")
        {
            const std::string path = takeString(args, length);
            if (path == "refuse")
            {
                send(error, "no presets today");
                return SOUNDOR_CONTROLLER_FAILED;
            }
            if (path == "wait")
            {
                self.waiting.insert(operation);
                return SOUNDOR_CONTROLLER_OK;
            }
            if (path == "missing")
                item.bytes = { 0 };
            else if (path == "fail")
            {
                item.ok = false;
                const std::string message = "cannot load";
                item.bytes.assign(message.begin(), message.end());
            }
            else
            {
                item.bytes = { 1 };
                putString(item.bytes, path);
                put(item.bytes, std::uint32_t { 2 });
                put(item.bytes, 0.5F);
                put(item.bytes, 1.0F);
            }
        }
        self.queue.push_back(std::move(item));
        self.host.wake(self.host.user);
        return SOUNDOR_CONTROLLER_OK;
    }

    void fakeCancel(void* handle, std::uint64_t operation)
    {
        Fake& self = fake(handle);
        self.cancelled.push_back(operation);
        self.waiting.erase(operation);
        std::erase_if(self.queue, [&](const Fake::Item& item) { return item.operation == operation; });
    }

    std::int32_t fakeRun(void* handle, std::uint64_t* operation, SoundorWriter out)
    {
        Fake& self = fake(handle);
        if (self.queue.empty())
            return SOUNDOR_CONTROLLER_RAN_NOTHING;
        Fake::Item item = std::move(self.queue.front());
        self.queue.pop_front();
        if (item.operation == 0)
        {
            ++self.tasks;
            return SOUNDOR_CONTROLLER_RAN_TASK;
        }
        *operation = item.operation;
        send(out, item.bytes.data(), item.bytes.size());
        return item.ok ? SOUNDOR_CONTROLLER_RAN_COMPLETED : SOUNDOR_CONTROLLER_RAN_FAILED;
    }

    processor::RustControllerFunctions functions()
    {
        return { fakeInfo, fakeCreate, fakeDestroy, fakeCall, fakeStart, fakeCancel, fakeRun };
    }

    struct Services final : processor::ControllerServices
    {
        void wake() noexcept override { ++wakes; }
        double parameter(std::uint32_t index) override { return parameters.at(index); }
        void setParameter(std::uint32_t index, double plain) override { parameters.at(index) = plain; }
        std::string state(std::uint32_t) override { return "null"; }
        void setState(std::uint32_t, std::string_view json) override
        {
            if (json.size() > 8)
                throw std::invalid_argument("state value too long");
        }
        bool history(HistoryAction) override { return false; }
        void loadPreset(std::string_view) override {}

        int wakes = 0;
        std::vector<double> parameters { 0, 0 };
    };

    struct Fixture
    {
        // First: what the fake ABI reports, reset before the controller reads it.
        bool reset = (exported() = {}, true);

        js::Result<Value> run(const std::string& body)
        {
            auto evaluated = context->evaluateModule(
                soundor::test::module(std::string("import * as n from 'soundor:native';\n") + body),
                "/test" + std::to_string(++counter) + ".js");
            if (! evaluated)
                return evaluated.error();
            return context->evaluateScript("globalThis.result");
        }

        Value value(const std::string& body)
        {
            auto result = run(body);
            REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
            return result.value();
        }

        std::string shown(const std::string& expression)
        {
            return value("globalThis.result = JSON.stringify(" + expression
                         + ", (k, v) => typeof v === 'bigint' ? v + 'n' : ArrayBuffer.isView(v) ? "
                           "v.constructor.name + '[' + Array.from(v, String).join(',') + ']' : v);")
                .asString();
        }

        std::string error(const std::string& body)
        {
            auto result = run(body);
            REQUIRE_FALSE(result.ok());
            return result.error().toString();
        }

        Fixture() { native::installController(*context, controller, events, streams); }

        Services services;
        std::shared_ptr<RustController> controller =
            std::make_shared<RustController>(descriptor(), functions(), services, nullptr);
        js::Runtime runtime;
        native::Events events;
        native::Streams streams;
        std::unique_ptr<js::Context> context = std::make_unique<js::Context>(runtime);
        int counter = 0;
    };
} // namespace

TEST_SUITE("Rust controller")
{
    TEST_CASE("the descriptor is the config's contract")
    {
        const auto parsed = ControllerContract::parse(descriptor());
        REQUIRE(parsed.has_value());
        const auto& contract = *parsed; // NOLINT(bugprone-unchecked-optional-access): required above
        CHECK(contract.parameterCount == 0);
        CHECK(contract.state.empty());
        REQUIRE(contract.methods.size() == 30);
        CHECK(contract.methods.front().name == "add");
        const auto load =
            std::ranges::find(contract.methods, std::string("loadPreset"), &ControllerContract::Method::name);
        REQUIRE(load != contract.methods.end());
        CHECK(load->async);
        CHECK(load->args.at(0).name == "path");
        CHECK(contract.nodes.at(load->returns).tag == ControllerContract::Tag::Nullable);
        const auto curve = std::ranges::find(contract.types, std::string("Curve"), &ControllerContract::Declared::name);
        REQUIRE(curve != contract.types.end());
        CHECK(curve->isEnum);
        CHECK(curve->valueViews.at(2) == "low-cut");
    }

    TEST_CASE("a malformed descriptor is refused")
    {
        const auto bytes = descriptor();
        CHECK_FALSE(ControllerContract::parse(bytes.first(bytes.size() - 1)).has_value());
        std::vector<std::uint8_t> trailing(bytes.begin(), bytes.end());
        trailing.push_back(0);
        CHECK_FALSE(ControllerContract::parse(trailing).has_value());
        std::vector<std::uint8_t> version(bytes.begin(), bytes.end());
        version[4] = 2;
        CHECK_FALSE(ControllerContract::parse(version).has_value());
        CHECK_FALSE(ControllerContract::parse({}).has_value());
        // A huge count never allocates for it.
        const std::uint8_t huge[] = { 'S', 'N', 'D', 'C', 1, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x7f };
        CHECK_FALSE(ControllerContract::parse(huge).has_value());
    }

    TEST_CASE("a crate without a controller, or a stale one, is reported and never called")
    {
        Services services;
        exported() = {};
        exported().present = false;
        {
            RustController absent(descriptor(), functions(), services, nullptr);
            CHECK_FALSE(absent.present());
            CHECK_FALSE(absent.active());
            CHECK(absent.error().find("exports no controller") != std::string::npos);
        }
        exported() = {};
        exported().descriptor.back() ^= 1;
        {
            RustController stale(descriptor(), functions(), services, nullptr);
            CHECK(stale.present());
            CHECK_FALSE(stale.active());
            CHECK(stale.error().find("another soundor.config") != std::string::npos);
            CHECK(stale.call(0, {}).message == stale.error());
        }
        exported() = {};
        exported().abiVersion = 99;
        {
            RustController other(descriptor(), functions(), services, nullptr);
            CHECK(other.error().find("another Soundor ABI") != std::string::npos);
        }
        exported() = {};
        processor::RustControllerFunctions missing = functions();
        missing.run = nullptr;
        RustController incomplete(descriptor(), missing, services, nullptr);
        CHECK(incomplete.error().find("missing a function") != std::string::npos);
    }

    TEST_CASE("JavaScript calls synchronous methods, values converted both ways")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = Object.keys(n).sort().join(',');").asString()
              == "add,analyze,applyPreset,centroid,curves,echoBuffers,echoFloat32,echoInt64,echoNumbers,echoOptionals,"
                 "echoUint64,echoUint8,events,fail,firstPoint,getSpectrum,greet,invert,isEven,joinTags,loadPreset,"
                 "makeRamp,reset,reverseBytes,save,scale,setSolo,solo,streams,sumBytes,sumInts,sumWords");
        CHECK(f.value("globalThis.result = n.add.length;").asNumber() == 2);
        CHECK(f.value("globalThis.result = n.add(40, 2);").asNumber() == 42);
        CHECK(f.value("globalThis.result = n.greet('wörld');").asString() == "hello wörld");
        CHECK(f.value("globalThis.result = n.isEven(4);").asBoolean());
        CHECK(f.value("globalThis.result = n.invert('low-cut');").asString() == "low-cut");
        CHECK(f.shown("n.echoInt64(-9223372036854775808n)") == R"("-9223372036854775808n")");
        CHECK(f.shown("n.echoUint64(18446744073709551615n)") == R"("18446744073709551615n")");
        CHECK(f.value("globalThis.result = n.echoUint8(255);").asNumber() == 255);
        CHECK(f.value("globalThis.result = n.echoFloat32(0.1);").asNumber() == static_cast<double>(0.1F));
        CHECK(f.shown("n.echoNumbers({ i8: -128, u8: 255, i16: -32768, u16: 65535, i32: -2147483648, "
                      "u32: 4294967295, i64: -1n, u64: 1n, f32: 0.5, f64: 1e300 })")
              == R"({"i8":-128,"u8":255,"i16":-32768,"u16":65535,"i32":-2147483648,"u32":4294967295,)"
                 R"("i64":"-1n","u64":"1n","f32":0.5,"f64":1e+300})");
        CHECK(f.shown("n.echoBuffers({ i8: new Int8Array([-1]), u8: new Uint8Array([1, 2]), i16: new Int16Array(0), "
                      "u16: new Uint16Array([7]), i32: new Int32Array([-5]), u32: new Uint32Array(0), "
                      "i64: new BigInt64Array([3n]), u64: new BigUint64Array(0), f32: new Float32Array([0.25]), "
                      "f64: new Float64Array([2.5, -1]) })")
              == R"({"i8":"Int8Array[-1]","u8":"Uint8Array[1,2]","i16":"Int16Array[]","u16":"Uint16Array[7]",)"
                 R"("i32":"Int32Array[-5]","u32":"Uint32Array[]","i64":"BigInt64Array[3]","u64":"BigUint64Array[]",)"
                 R"("f32":"Float32Array[0.25]","f64":"Float64Array[2.5,-1]"})");
        CHECK(f.shown("n.echoOptionals({ slot: null, id: 5n, name: null, curve: 'linear', point: { x: 1, y: 2 }, "
                      "gains: [0.5], samples: null })")
              == R"({"slot":null,"id":"5n","name":null,"curve":"linear","point":{"x":1,"y":2},"gains":[0.5],)"
                 R"("samples":null})");
    }

    TEST_CASE("arguments are checked as the generated C++ bindings check them, with their messages")
    {
        Fixture f;
        CHECK(f.error("n.add(1, '2');") == "TypeError: add(): b: expected int32, got string");
        CHECK(f.error("n.add(1);") == "TypeError: add() expects 2 arguments, got 1");
        CHECK(f.value("globalThis.result = n.add(1, 2, 'ignored');").asNumber() == 3);
        CHECK(f.error("n.greet(null);") == "TypeError: greet(): name: expected string, got null");
        CHECK(f.error("n.isEven(true);") == "TypeError: isEven(): value: expected int32, got boolean");
        CHECK(f.error("n.analyze(new Float64Array(2));")
              == "TypeError: analyze(): samples: expected Float32Array, got typed array");
        CHECK(f.error("n.invert('cubic');")
              == "TypeError: invert(): curve: expected one of 'linear', 'exponential', 'low-cut', got 'cubic'");
        CHECK(f.error("n.centroid([{ x: 1, y: 2 }, { x: 1 }]);")
              == "TypeError: centroid(): points[1].y: expected float64, got undefined");
        CHECK(f.error("n.joinTags(['a', 2]);") == "TypeError: joinTags(): tags[1]: expected string, got number");
        CHECK(f.error("n.echoUint8(1.5);") == "TypeError: echoUint8(): value: expected an integer (uint8), got 1.5");
        CHECK(f.error("n.echoUint8(1n);") == "TypeError: echoUint8(): value: expected uint8, got bigint");
        CHECK(f.error("n.echoInt64(1);") == "TypeError: echoInt64(): value: expected int64, got number");
    }

    TEST_CASE("a method's failure is an Error, and a malformed result too")
    {
        Fixture f;
        CHECK(f.error("n.fail('broken');") == "Error: fail(): broken");
        CHECK(f.error("n.solo();") == "Error: solo(): the controller's result is malformed");
        CHECK(f.error("n.curves();") == "Error: curves(): not faked");
    }

    TEST_CASE("a task's services are the runtime's, and their failures reach JavaScript")
    {
        Fixture f;
        CHECK(f.error("n.reset();") == "Error: reset(): state value too long");
        CHECK(f.services.parameters[1] == 0.25);
    }

    TEST_CASE("async methods settle their promise when the controller is pumped, then run its reactions")
    {
        Fixture f;
        f.value(R"(
            globalThis.result = 'pending';
            n.loadPreset('warm').then((preset) => { globalThis.result = JSON.stringify(preset); });
            n.loadPreset('fail').catch((error) => { globalThis.failure = String(error); });
            n.loadPreset('missing').then((preset) => { globalThis.missing = preset; });
            n.save({ name: 'a', gains: [] }).then((value) => { globalThis.saved = value === undefined; });
        )");
        CHECK(f.services.wakes == 4);
        // Nothing settles before the controller runs.
        CHECK(f.context->evaluateScript("globalThis.result").value().asString() == "pending");
        CHECK_FALSE(f.controller->pump());
        // The microtask checkpoint ran each promise's reactions: no job pump needed.
        CHECK(f.context->evaluateScript("globalThis.result").value().asString()
              == R"({"name":"warm","gains":[0.5,1]})");
        CHECK(f.context->evaluateScript("globalThis.failure").value().asString() == "Error: loadPreset(): cannot load");
        CHECK(f.context->evaluateScript("globalThis.missing").value().isNull());
        CHECK(f.context->evaluateScript("globalThis.saved").value().asBoolean());
    }

    TEST_CASE("an async method that fails to start rejects, and its arguments are checked synchronously")
    {
        Fixture f;
        f.value("n.loadPreset('refuse').catch((error) => { globalThis.result = String(error); });");
        f.runtime.runPendingJobs();
        CHECK(f.context->evaluateScript("globalThis.result").value().asString()
              == "Error: loadPreset(): no presets today");
        CHECK(f.error("n.loadPreset(3);") == "TypeError: loadPreset(): path: expected string, got number");
    }

    TEST_CASE("a context that goes cancels what it started; the controller lives on")
    {
        Fixture f;
        f.value("n.loadPreset('wait'); n.loadPreset('warm');");
        REQUIRE(last != nullptr);
        CHECK(last->waiting.size() == 1);
        f.context.reset();
        CHECK(last->cancelled.size() == 2);
        CHECK(last->waiting.empty());
        CHECK_FALSE(f.controller->pump());
        // A new editor's context gets the same controller.
        f.context = std::make_unique<js::Context>(f.runtime);
        native::installController(*f.context, f.controller, f.events, f.streams);
        CHECK(f.value("globalThis.result = n.add(2, 2);").asNumber() == 4);
    }

    TEST_CASE("pumping is bounded: a busy controller yields after its budget")
    {
        Fixture f;
        REQUIRE(last != nullptr);
        for (int i = 0; i < 5; ++i)
            last->queue.push_back({});
        CHECK(f.controller->pump(std::chrono::nanoseconds(0)));
        CHECK(last->tasks == 1);
        while (f.controller->pump(std::chrono::nanoseconds(0)))
        {
        }
        CHECK(last->tasks == 5);
        CHECK_FALSE(f.controller->pump());
    }

    TEST_CASE("shutting down destroys the controller once; calls then fail")
    {
        Fixture f;
        f.value("n.loadPreset('wait').catch((error) => { globalThis.result = String(error); });");
        const int before = destroyed;
        f.controller->shutdown();
        f.controller->shutdown();
        CHECK(destroyed == before + 1);
        CHECK_FALSE(f.controller->active());
        CHECK_FALSE(f.controller->pump());
        CHECK(f.error("n.add(1, 2);") == "Error: add(): The plugin instance has shut down.");
        f.runtime.runPendingJobs();
        CHECK(f.context->evaluateScript("globalThis.result").value().asString().find("Error: loadPreset(): ") == 0);
    }
}
