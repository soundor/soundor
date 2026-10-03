// Drives the generated `soundor:native` bindings (tests/generated, produced from
// the fixture in src/native-codegen.test.ts) from JavaScript.

#include <soundor/js/Context.h>
#include <soundor/native/SoundorNative.h>

#include <doctest/doctest.h>

#include <cmath>
#include <memory>
#include <numeric>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

using namespace soundor;
using js::Value;

namespace
{
    struct TestPreset final : native::Preset
    {
        explicit TestPreset(std::string presetName, int& liveCount) : name(std::move(presetName)), live(liveCount)
        {
            ++live;
        }
        ~TestPreset() override { --live; }

        TestPreset(const TestPreset&) = delete;
        TestPreset& operator=(const TestPreset&) = delete;

        std::string name;
        int& live;
    };

    class FixtureApi final : public native::NativeApi
    {
    public:
        double add(double a, double b) override { return a + b; }

        native::Analysis analyze(std::span<const float> samples) override
        {
            native::Analysis result;
            double sum = 0;
            for (const float sample : samples)
            {
                sum += double(sample) * double(sample);
                result.peak = std::max(result.peak, double(std::abs(sample)));
            }
            result.rms = samples.empty() ? 0 : std::sqrt(sum / double(samples.size()));
            result.label = "analysed " + std::to_string(samples.size());
            result.clipped = result.peak >= 1.0;
            result.curve = native::Curve::LowCut;
            result.points = { { 1, 2 }, { 3, 4 } };
            result.tags = { "a", "b" };
            return result;
        }

        native::Point centroid(std::vector<native::Point> points) override
        {
            native::Point sum;
            for (const auto& point : points)
            {
                sum.x += point.x;
                sum.y += point.y;
            }
            const auto count = double(points.size());
            return { sum.x / count, sum.y / count };
        }

        std::shared_ptr<native::Preset> createPreset(std::string name) override
        {
            return std::make_shared<TestPreset>(std::move(name), livePresets);
        }

        void fail(std::string message) override { throw std::runtime_error(message); }

        std::string greet(std::string name) override { return "hello " + name; }

        native::Curve invert(native::Curve curve) override
        {
            return curve == native::Curve::Linear ? native::Curve::Exponential : native::Curve::Linear;
        }

        bool isEven(double value) override { return std::fmod(value, 2.0) == 0.0; }

        std::string joinTags(std::vector<std::string> tags) override
        {
            std::string joined;
            for (const auto& tag : tags)
                joined += (joined.empty() ? "" : ",") + tag;
            return joined;
        }

        std::vector<std::shared_ptr<native::Preset>> listPresets() override
        {
            return { createPreset("one"), createPreset("two") };
        }

        void loadPreset(std::string name, js::Promise<std::shared_ptr<native::Preset>> promise) override
        {
            if (name == "sync")
                promise.resolve(createPreset(name));
            else if (name == "throw")
                throw std::runtime_error("cannot load");
            else if (name != "drop")
                pendingLoads.emplace_back(std::move(name), std::move(promise));
        }

        std::vector<std::byte> makeBytes(double count) override
        {
            std::vector<std::byte> bytes(static_cast<std::size_t>(count));
            for (std::size_t i = 0; i < bytes.size(); ++i)
                bytes[i] = static_cast<std::byte>(i);
            return bytes;
        }

        std::vector<float> makeRamp(double length) override
        {
            std::vector<float> ramp(static_cast<std::size_t>(length));
            std::iota(ramp.begin(), ramp.end(), 0.0f);
            return ramp;
        }

        std::string presetName(std::shared_ptr<native::Preset> preset) override
        {
            return static_cast<TestPreset&>(*preset).name;
        }

        void reset() override { ++resets; }

        std::vector<std::uint8_t> reverseBytes(std::span<const std::uint8_t> data) override
        {
            return { data.rbegin(), data.rend() };
        }

        void save(std::shared_ptr<native::Preset> preset, js::Promise<void> promise) override
        {
            saved = presetName(std::move(preset));
            promise.resolve();
        }

        std::vector<double> scale(std::span<const double> values, double factor) override
        {
            std::vector<double> result;
            for (const double value : values)
                result.push_back(value * factor);
            return result;
        }

        double sumBytes(std::span<const std::byte> data) override
        {
            double sum = 0;
            for (const std::byte byte : data)
                sum += double(std::to_integer<int>(byte));
            return sum;
        }

        double sumInts(std::span<const std::int32_t> values) override
        {
            return std::accumulate(values.begin(), values.end(), 0.0);
        }

        int livePresets = 0;
        int resets = 0;
        std::string saved;
        std::vector<std::pair<std::string, js::Promise<std::shared_ptr<native::Preset>>>> pendingLoads;
    };

    struct Fixture
    {
        Fixture() { native::install(context, api); }

        // Runs `body` as a module with the whole API imported as `n`, then
        // returns globalThis.result.
        js::Result<Value> run(const std::string& body)
        {
            auto evaluated = context.evaluateModule("import * as n from 'soundor:native';\n" + body,
                                                    "/test" + std::to_string(++counter) + ".js");
            if (! evaluated)
                return evaluated.error();
            return context.evaluateScript("globalThis.result");
        }

        Value value(const std::string& body)
        {
            auto result = run(body);
            REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
            return result.value();
        }

        std::string error(const std::string& body)
        {
            auto result = run(body);
            REQUIRE_FALSE(result.ok());
            return result.error().toString();
        }

        js::Runtime runtime;
        js::Context context { runtime };
        std::shared_ptr<FixtureApi> api = std::make_shared<FixtureApi>();
        int counter = 0;
    };
} // namespace

TEST_SUITE("soundor:native")
{
    TEST_CASE("exports exactly the declared methods")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = Object.keys(n).sort().join(',');").asString()
              == "add,analyze,centroid,createPreset,fail,greet,invert,isEven,joinTags,listPresets,loadPreset,"
                 "makeBytes,makeRamp,presetName,reset,reverseBytes,save,scale,sumBytes,sumInts");
        CHECK(f.value("globalThis.result = n.add.length;").asNumber() == 2);
    }

    TEST_CASE("passes primitives both ways")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = n.add(40, 2);").asNumber() == 42);
        CHECK(f.value("globalThis.result = n.greet('wörld');").asString() == "hello wörld");
        CHECK(f.value("globalThis.result = n.isEven(4);").asBoolean());
        CHECK(f.value("n.reset(); globalThis.result = 0;").isNumber());
        CHECK(f.api->resets == 1);
    }

    TEST_CASE("validates arguments with precise messages")
    {
        Fixture f;
        CHECK(f.error("n.add(1, '2');") == "TypeError: add(): b: expected number, got string");
        CHECK(f.error("n.add(1);") == "TypeError: add() expects 2 arguments, got 1");
        CHECK(f.value("globalThis.result = n.add(1, 2, 'ignored');").asNumber() == 3);
        CHECK(f.error("n.greet(null);") == "TypeError: greet(): name: expected string, got null");
        CHECK(f.error("n.isEven(true);") == "TypeError: isEven(): value: expected number, got boolean");
        CHECK(f.error("n.analyze(new Float64Array(2));")
              == "TypeError: analyze(): samples: expected Float32Array, got typed array");
        CHECK(f.error("n.analyze([1, 2]);") == "TypeError: analyze(): samples: expected Float32Array, got array");
        CHECK(f.error("n.invert('cubic');")
              == "TypeError: invert(): curve: expected one of 'linear', 'exponential', 'low-cut', got 'cubic'");
        CHECK(f.error("n.centroid([{ x: 1, y: 2 }, { x: 1 }]);")
              == "TypeError: centroid(): points[1].y: expected number, got undefined");
        CHECK(f.error("n.centroid({});") == "TypeError: centroid(): points: expected array, got object");
        CHECK(f.error("n.joinTags(['a', 2]);") == "TypeError: joinTags(): tags[1]: expected string, got number");
    }

    TEST_CASE("borrows typed arrays and ArrayBuffers without copying")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = n.sumBytes(new Uint8Array([1, 2, 3, 250]).buffer);").asNumber() == 256);
        CHECK(f.value("globalThis.result = n.sumInts(new Int32Array([-5, 10, 20]));").asNumber() == 25);
        // A view into the middle of a larger buffer sees only its own elements.
        CHECK(f.value("const all = new Int32Array([100, 1, 2, 100]);"
                      "globalThis.result = n.sumInts(all.subarray(1, 3));")
                  .asNumber()
              == 3);
        CHECK(f.value("globalThis.result = n.analyze(new Float32Array([0.5, -1, 0.5])).peak;").asNumber() == 1);
        CHECK(f.error("const buffer = new ArrayBuffer(8); buffer.transfer(); n.sumBytes(buffer);").find("TypeError")
              == 0);
        CHECK(f.error("const array = new Int32Array(2); array.buffer.transfer(); n.sumInts(array);").find("TypeError")
              == 0);
        CHECK(f.value("globalThis.result = n.sumBytes(new ArrayBuffer(0));").asNumber() == 0);
    }

    TEST_CASE("returns binary data as JavaScript-owned buffers")
    {
        Fixture f;
        CHECK(f.value("const ramp = n.makeRamp(4);"
                      "globalThis.result = ramp instanceof Float32Array && ramp.join(',');")
                  .asString()
              == "0,1,2,3");
        CHECK(f.value("const bytes = n.makeBytes(3);"
                      "globalThis.result = bytes instanceof ArrayBuffer && new Uint8Array(bytes).join(',');")
                  .asString()
              == "0,1,2");
        CHECK(f.value("globalThis.result = n.scale(new Float64Array([1, 2]), 1.5).join(',');").asString() == "1.5,3");
        CHECK(f.value("globalThis.result = n.reverseBytes(new Uint8Array([1, 2, 3])).join(',');").asString()
              == "3,2,1");
        CHECK(f.value("globalThis.result = n.makeRamp(0).length;").asNumber() == 0);
        // The buffer survives the call and garbage collection of everything else.
        REQUIRE(f.run("globalThis.kept = n.makeRamp(1000); globalThis.result = 0;").ok());
        f.runtime.collectGarbage();
        CHECK(f.context.evaluateScript("kept[999]").value().asNumber() == 999);
    }

    TEST_CASE("converts structs, enums and arrays")
    {
        Fixture f;
        CHECK(f.value("const a = n.analyze(new Float32Array([1, -1]));"
                      "globalThis.result = JSON.stringify(a);")
                  .asString()
              == R"({"rms":1,"peak":1,"label":"analysed 2","clipped":true,"curve":"low-cut",)"
                 R"("points":[{"x":1,"y":2},{"x":3,"y":4}],"tags":["a","b"]})");
        CHECK(f.value("globalThis.result = n.invert('linear');").asString() == "exponential");
        CHECK(f.value("globalThis.result = JSON.stringify(n.centroid([{ x: 0, y: 0 }, { x: 2, y: 4 }]));").asString()
              == R"({"x":1,"y":2})");
        CHECK(f.value("globalThis.result = n.joinTags(['x', 'y', 'z']);").asString() == "x,y,z");
    }

    TEST_CASE("turns native exceptions into JavaScript errors")
    {
        Fixture f;
        CHECK(f.error("n.fail('disk full');") == "Error: fail(): disk full");
        CHECK(f.value("try { n.fail('x'); } catch (e) { globalThis.result = e instanceof Error; }").asBoolean());
        // The context keeps working afterwards.
        CHECK(f.value("globalThis.result = n.add(1, 1);").asNumber() == 2);
    }

    TEST_CASE("represents native objects as opaque handles")
    {
        Fixture f;
        CHECK(f.value("const p = n.createPreset('warm');"
                      "globalThis.result = [typeof p, Object.keys(p).length, n.presetName(p)].join(',');")
                  .asString()
              == "object,0,warm");
        CHECK(f.value("globalThis.result = n.listPresets().map(n.presetName).join(',');").asString() == "one,two");

        // Handles cannot be forged from plain objects or other values.
        CHECK(f.error("n.presetName({});") == "TypeError: presetName(): preset: expected Preset, got object");
        CHECK(f.error("n.presetName(new Float32Array(1));")
              == "TypeError: presetName(): preset: expected Preset, got typed array");
    }

    TEST_CASE("releases native objects when JavaScript drops their handles")
    {
        Fixture f;
        REQUIRE(
            f.run("globalThis.keep = n.createPreset('kept'); n.createPreset('dropped'); globalThis.result = 0;").ok());
        f.runtime.collectGarbage();
        CHECK(f.api->livePresets == 1);
        REQUIRE(f.context.evaluateScript("globalThis.keep = undefined").ok());
        f.runtime.collectGarbage();
        CHECK(f.api->livePresets == 0);
    }

    TEST_CASE("releases native objects when the runtime is torn down")
    {
        auto api = std::make_shared<FixtureApi>();
        {
            js::Runtime runtime;
            js::Context context(runtime);
            native::install(context, api);
            REQUIRE(context
                        .evaluateModule("import { createPreset } from 'soundor:native';"
                                        "globalThis.held = [createPreset('a'), createPreset('b')];",
                                        "/held.js")
                        .ok());
            CHECK(api->livePresets == 2);
        }
        CHECK(api->livePresets == 0);
    }

    TEST_CASE("async methods return promises settled later")
    {
        Fixture f;
        REQUIRE(f.run("globalThis.log = [];"
                      "n.loadPreset('later').then((p) => log.push('loaded ' + n.presetName(p)));"
                      "globalThis.result = 0;")
                    .ok());
        CHECK(f.context.evaluateScript("log.length").value().asNumber() == 0);
        REQUIRE(f.api->pendingLoads.size() == 1);

        auto [name, promise] = std::move(f.api->pendingLoads.front());
        f.api->pendingLoads.clear();
        CHECK(promise.isPending());
        promise.resolve(f.api->createPreset(name));
        CHECK_FALSE(promise.isPending());
        promise.resolve(f.api->createPreset("ignored")); // second settle is a no-op
        f.runtime.runPendingJobs();
        CHECK(f.context.evaluateScript("log.join()").value().asString() == "loaded later");
    }

    TEST_CASE("async methods resolve synchronously, reject, and handle void results")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = n.presetName(await n.loadPreset('sync'));").asString() == "sync");
        CHECK(f.value("globalThis.result = await n.save(n.createPreset('mine'));").isUndefined());
        CHECK(f.api->saved == "mine");
        CHECK(f.value("globalThis.result = await n.loadPreset('throw').catch((e) => e.message);").asString()
              == "loadPreset(): cannot load");

        REQUIRE(
            f.run("globalThis.outcome = n.loadPreset('later').catch((e) => e.message); globalThis.result = 0;").ok());
        f.api->pendingLoads.front().second.reject("not found");
        f.api->pendingLoads.clear();
        f.runtime.runPendingJobs();
        CHECK(f.value("globalThis.result = await outcome;").asString() == "loadPreset(): not found");
    }

    TEST_CASE("a promise dropped without settling rejects")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = await n.loadPreset('drop').catch((e) => e.message);").asString()
              == "loadPreset(): the native implementation finished without settling its promise");
    }

    TEST_CASE("settling after the context is gone is harmless")
    {
        auto api = std::make_shared<FixtureApi>();
        {
            js::Runtime runtime;
            js::Context context(runtime);
            native::install(context, api);
            REQUIRE(context.evaluateModule("import { loadPreset } from 'soundor:native'; loadPreset('later');", "/x.js")
                        .ok());
        }
        REQUIRE(api->pendingLoads.size() == 1);
        auto& promise = api->pendingLoads.front().second;
        CHECK_FALSE(promise.isPending());
        promise.resolve(api->createPreset("too late"));
        promise.reject("too late");
        api->pendingLoads.clear();
    }

    TEST_CASE("argument validation happens before the promise exists")
    {
        Fixture f;
        CHECK(f.error("n.loadPreset(1);") == "TypeError: loadPreset(): name: expected string, got number");
    }

    TEST_CASE("each context gets its own API instance")
    {
        js::Runtime runtime;
        js::Context first(runtime);
        js::Context second(runtime);
        auto a = std::make_shared<FixtureApi>();
        auto b = std::make_shared<FixtureApi>();
        native::install(first, a);
        native::install(second, b);
        REQUIRE(first.evaluateModule("import { reset } from 'soundor:native'; reset(); reset();", "/a.js").ok());
        REQUIRE(second.evaluateModule("import { reset } from 'soundor:native'; reset();", "/b.js").ok());
        CHECK(a->resets == 2);
        CHECK(b->resets == 1);
    }

    TEST_CASE("handles from one context's API are type-checked in another")
    {
        js::Runtime runtime;
        js::Context context(runtime);
        native::install(context, std::make_shared<FixtureApi>());
        // A handle is only accepted as the declared type it was created as.
        REQUIRE(context
                    .evaluateModule("import * as n from 'soundor:native';"
                                    "globalThis.ok = n.presetName(n.createPreset('x')) === 'x';",
                                    "/t.js")
                    .ok());
        CHECK(context.evaluateScript("ok").value().asBoolean());
    }

    TEST_CASE("install requires an implementation")
    {
        js::Runtime runtime;
        js::Context context(runtime);
        CHECK_THROWS_AS(native::install(context, nullptr), std::invalid_argument);
    }
}
