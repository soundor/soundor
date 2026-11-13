// Drives the generated `soundor:native` bindings (tests/generated, produced from
// the fixture in src/native-codegen.test.ts) from JavaScript.

#include "../support/Modules.h"

#include <soundor/js/Context.h>
#include <soundor/native/SoundorNative.h>

#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <numeric>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using namespace soundor;
using js::Value;

namespace
{
    class FixtureApi final : public native::NativeApi
    {
    public:
        std::int32_t add(std::int32_t a, std::int32_t b) override { return a + b; }

        native::Analysis analyze(std::span<const float> samples) override
        {
            native::Analysis result;
            double sum = 0;
            for (const float sample : samples)
            {
                sum += double(sample) * double(sample);
                result.peak = std::max(result.peak, std::abs(sample));
            }
            result.rms = samples.empty() ? 0 : float(std::sqrt(sum / double(samples.size())));
            result.label = "analysed " + std::to_string(samples.size());
            result.clipped = result.peak >= 1.0F;
            result.curve = native::Curve::LowCut;
            result.points = { { 1, 2 }, { 3, 4 } };
            result.tags = { "a", "b" };
            return result;
        }

        void applyPreset(native::Preset preset) override { applied = std::move(preset); }

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

        std::vector<native::Curve> curves() override { return { native::Curve::LowCut, native::Curve::Linear }; }

        native::Buffers echoBuffers(native::Buffers buffers) override { return buffers; }
        float echoFloat32(float value) override { return value; }
        std::int64_t echoInt64(std::int64_t value) override { return value; }
        native::Numbers echoNumbers(native::Numbers numbers) override { return numbers; }
        native::Optionals echoOptionals(native::Optionals optionals) override { return optionals; }
        std::uint64_t echoUint64(std::uint64_t value) override { return value; }
        std::uint8_t echoUint8(std::uint8_t value) override { return value; }

        void fail(std::string message) override { throw std::runtime_error(message); }

        std::optional<native::Point> firstPoint(std::optional<std::vector<native::Point>> points) override
        {
            if (! points.has_value() || points->empty())
                return std::nullopt;
            return points->front();
        }

        std::vector<float> getSpectrum() override { return { 0.25F, 0.5F, 1.0F }; }

        std::string greet(std::string name) override { return "hello " + name; }

        native::Curve invert(native::Curve curve) override
        {
            return curve == native::Curve::Linear ? native::Curve::Exponential : native::Curve::Linear;
        }

        bool isEven(std::int32_t value) override { return value % 2 == 0; }

        std::string joinTags(std::vector<std::string> tags) override
        {
            std::string joined;
            for (const auto& tag : tags)
                joined += (joined.empty() ? "" : ",") + tag;
            return joined;
        }

        void loadPreset(std::string path, js::Promise<std::optional<native::Preset>> promise) override
        {
            if (path == "sync")
                promise.resolve(native::Preset { .name = path, .gains = { 0.5F, 1.0F } });
            else if (path == "missing")
                promise.resolve(std::nullopt);
            else if (path == "throw")
                throw std::runtime_error("cannot load");
            else if (path != "drop")
                pendingLoads.emplace_back(std::move(path), std::move(promise));
        }

        std::vector<float> makeRamp(std::uint32_t length) override
        {
            std::vector<float> ramp(length);
            std::iota(ramp.begin(), ramp.end(), 0.0F);
            return ramp;
        }

        void reset() override { ++resets; }

        std::vector<std::uint8_t> reverseBytes(std::span<const std::uint8_t> data) override
        {
            return { data.rbegin(), data.rend() };
        }

        void save(native::Preset preset, js::Promise<void> promise) override
        {
            saved = preset.name;
            promise.resolve();
        }

        std::vector<double> scale(std::span<const double> values, double factor) override
        {
            std::vector<double> result;
            for (const double value : values)
                result.push_back(value * factor);
            return result;
        }

        void setSolo(std::optional<std::int32_t> slot) override { soloSlot = slot; }
        std::optional<std::int32_t> solo() override { return soloSlot; }

        std::uint32_t sumBytes(std::span<const std::uint8_t> data) override
        {
            return std::accumulate(data.begin(), data.end(), std::uint32_t { 0 });
        }

        std::int64_t sumInts(std::span<const std::int32_t> values) override
        {
            return std::accumulate(values.begin(), values.end(), std::int64_t { 0 });
        }

        std::optional<std::uint64_t> sumWords(std::optional<std::span<const std::uint64_t>> values) override
        {
            if (! values.has_value())
                return std::nullopt;
            return std::accumulate(values->begin(), values->end(), std::uint64_t { 0 });
        }

        int resets = 0;
        std::string saved;
        std::optional<native::Preset> applied;
        std::optional<std::int32_t> soloSlot;
        std::vector<std::pair<std::string, js::Promise<std::optional<native::Preset>>>> pendingLoads;
    };

    // Plain JavaScript to build the arguments the tests pass.
    constexpr const char* helpers = R"(
        globalThis.numbers = (overrides = {}) => ({
            i8: 0, u8: 0, i16: 0, u16: 0, i32: 0, u32: 0, i64: 0n, u64: 0n, f32: 0, f64: 0, ...overrides,
        });
        globalThis.buffers = (overrides = {}) => ({
            i8: new Int8Array(0), u8: new Uint8Array(0), i16: new Int16Array(0), u16: new Uint16Array(0),
            i32: new Int32Array(0), u32: new Uint32Array(0), i64: new BigInt64Array(0), u64: new BigUint64Array(0),
            f32: new Float32Array(0), f64: new Float64Array(0), ...overrides,
        });
        globalThis.optionals = (overrides = {}) => ({
            slot: null, id: null, name: null, curve: null, point: null, gains: null, samples: null, ...overrides,
        });
        globalThis.show = (value) => JSON.stringify(value, (key, v) =>
            typeof v === 'bigint' ? v + 'n'
            : ArrayBuffer.isView(v) ? v.constructor.name + '[' + Array.from(v, String).join(',') + ']'
            : v);
    )";

    struct Fixture
    {
        // Runs `body` as a module with the whole API imported as `n`, then
        // returns globalThis.result.
        js::Result<Value> run(const std::string& body)
        {
            auto evaluated = context.evaluateModule(
                soundor::test::module(std::string("import * as n from 'soundor:native';\n") + helpers + body),
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

        // `expression`, shown with show().
        std::string shown(const std::string& expression)
        {
            return value("globalThis.result = show(" + expression + ");").asString();
        }

        std::string error(const std::string& body)
        {
            auto result = run(body);
            REQUIRE_FALSE(result.ok());
            return result.error().toString();
        }

        explicit Fixture(const js::RuntimeOptions& options = {}) : runtime(options)
        {
            native::install(context, api, events);
        }

        js::Runtime runtime;
        native::Events events;
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
              == "add,analyze,applyPreset,centroid,curves,echoBuffers,echoFloat32,echoInt64,echoNumbers,"
                 "echoOptionals,echoUint64,echoUint8,events,fail,firstPoint,getSpectrum,greet,invert,isEven,joinTags,"
                 "loadPreset,makeRamp,reset,reverseBytes,save,scale,setSolo,solo,sumBytes,sumInts,sumWords");
        CHECK(f.value("globalThis.result = n.add.length;").asNumber() == 2);
    }

    TEST_CASE("passes primitives both ways")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = n.add(40, 2);").asNumber() == 42);
        CHECK(f.value("globalThis.result = n.greet('wörld');").asString() == "hello wörld");
        CHECK(f.value("globalThis.result = n.isEven(4);").asBoolean());
        CHECK_FALSE(f.value("globalThis.result = n.isEven(-3);").asBoolean());
        CHECK(f.value("n.reset(); globalThis.result = 0;").isNumber());
        CHECK(f.api->resets == 1);
    }

    TEST_CASE("validates arguments with precise messages")
    {
        Fixture f;
        CHECK(f.error("n.add(1, '2');") == "TypeError: add(): b: expected int32, got string");
        CHECK(f.error("n.add(1);") == "TypeError: add() expects 2 arguments, got 1");
        CHECK(f.value("globalThis.result = n.add(1, 2, 'ignored');").asNumber() == 3);
        CHECK(f.error("n.greet(null);") == "TypeError: greet(): name: expected string, got null");
        CHECK(f.error("n.isEven(true);") == "TypeError: isEven(): value: expected int32, got boolean");
        CHECK(f.error("n.analyze(new Float64Array(2));")
              == "TypeError: analyze(): samples: expected Float32Array, got typed array");
        CHECK(f.error("n.analyze([1, 2]);") == "TypeError: analyze(): samples: expected Float32Array, got array");
        CHECK(f.error("n.invert('cubic');")
              == "TypeError: invert(): curve: expected one of 'linear', 'exponential', 'low-cut', got 'cubic'");
        CHECK(f.error("n.centroid([{ x: 1, y: 2 }, { x: 1 }]);")
              == "TypeError: centroid(): points[1].y: expected float64, got undefined");
        CHECK(f.error("n.centroid({});") == "TypeError: centroid(): points: expected array, got object");
        CHECK(f.error("n.joinTags(['a', 2]);") == "TypeError: joinTags(): tags[1]: expected string, got number");
    }

    TEST_CASE("integers of up to 32 bits: every boundary, nothing coerced")
    {
        Fixture f;
        CHECK(f.shown("n.echoNumbers(numbers({ i8: -128, u8: 255, i16: -32768, u16: 65535,"
                      "  i32: -2147483648, u32: 4294967295 }))")
              == R"({"i8":-128,"u8":255,"i16":-32768,"u16":65535,"i32":-2147483648,"u32":4294967295,)"
                 R"("i64":"0n","u64":"0n","f32":0,"f64":0})");
        CHECK(f.shown("n.echoNumbers(numbers({ i8: 127, i16: 32767, i32: 2147483647 }))")
              == R"({"i8":127,"u8":0,"i16":32767,"u16":0,"i32":2147483647,"u32":0,)"
                 R"("i64":"0n","u64":"0n","f32":0,"f64":0})");
        // -0 is the integer 0.
        CHECK(f.value("globalThis.result = Object.is(n.echoUint8(-0), 0);").asBoolean());

        const auto outOfRange = [&](const char* field, const char* value, const char* type, const char* range)
        {
            CHECK(f.error(std::string("n.echoNumbers(numbers({ ") + field + ": " + value + " }));")
                  == std::string("RangeError: echoNumbers(): numbers.") + field + ": " + value + " is out of range for "
                         + type + " (" + range + ")");
        };
        outOfRange("i8", "-129", "int8", "-128 to 127");
        outOfRange("i8", "128", "int8", "-128 to 127");
        outOfRange("u8", "-1", "uint8", "0 to 255");
        outOfRange("u8", "256", "uint8", "0 to 255");
        outOfRange("i16", "-32769", "int16", "-32768 to 32767");
        outOfRange("i16", "32768", "int16", "-32768 to 32767");
        outOfRange("u16", "-1", "uint16", "0 to 65535");
        outOfRange("u16", "65536", "uint16", "0 to 65535");
        outOfRange("i32", "-2147483649", "int32", "-2147483648 to 2147483647");
        outOfRange("i32", "2147483648", "int32", "-2147483648 to 2147483647");
        outOfRange("u32", "-1", "uint32", "0 to 4294967295");
        outOfRange("u32", "4294967296", "uint32", "0 to 4294967295");

        CHECK(f.error("n.echoUint8(1.5);") == "TypeError: echoUint8(): value: expected an integer (uint8), got 1.5");
        CHECK(f.error("n.echoUint8(NaN);") == "TypeError: echoUint8(): value: expected an integer (uint8), got NaN");
        CHECK(f.error("n.add(Infinity, 1);") == "TypeError: add(): a: expected an integer (int32), got Infinity");
        CHECK(f.error("n.echoUint8('1');") == "TypeError: echoUint8(): value: expected uint8, got string");
        CHECK(f.error("n.echoUint8(1n);") == "TypeError: echoUint8(): value: expected uint8, got bigint");
        CHECK(f.error("n.echoUint8(new Number(1));") == "TypeError: echoUint8(): value: expected uint8, got object");
    }

    TEST_CASE("64-bit integers are bigints over their whole range")
    {
        Fixture f;
        CHECK(f.shown("[n.echoInt64(-(2n ** 63n)), n.echoInt64(2n ** 63n - 1n), n.echoInt64(0n), n.echoInt64(-1n)]")
              == R"(["-9223372036854775808n","9223372036854775807n","0n","-1n"])");
        CHECK(f.shown("[n.echoUint64(0n), n.echoUint64(2n ** 64n - 1n), n.echoUint64(2n ** 53n + 1n)]")
              == R"(["0n","18446744073709551615n","9007199254740993n"])");
        CHECK(f.value("globalThis.result = typeof n.echoInt64(1n);").asString() == "bigint");
        CHECK(f.shown("n.echoNumbers(numbers({ i64: -(2n ** 63n), u64: 2n ** 64n - 1n }))")
              == R"({"i8":0,"u8":0,"i16":0,"u16":0,"i32":0,"u32":0,)"
                 R"("i64":"-9223372036854775808n","u64":"18446744073709551615n","f32":0,"f64":0})");
        CHECK(f.shown("n.sumInts(new Int32Array([2147483647, 2147483647]))") == R"("4294967294n")");

        CHECK(f.error("n.echoInt64(2n ** 63n);")
              == "RangeError: echoInt64(): value: 9223372036854775808 is out of range for int64 "
                 "(-9223372036854775808 to 9223372036854775807)");
        CHECK(f.error("n.echoInt64(-(2n ** 63n) - 1n);")
              == "RangeError: echoInt64(): value: -9223372036854775809 is out of range for int64 "
                 "(-9223372036854775808 to 9223372036854775807)");
        CHECK(f.error("n.echoUint64(-1n);")
              == "RangeError: echoUint64(): value: -1 is out of range for uint64 (0 to 18446744073709551615)");
        CHECK(f.error("n.echoUint64(2n ** 64n);")
              == "RangeError: echoUint64(): value: 18446744073709551616 is out of range for uint64 "
                 "(0 to 18446744073709551615)");
        CHECK(f.error("n.echoInt64(1);") == "TypeError: echoInt64(): value: expected int64, got number");
        CHECK(f.error("n.echoUint64('1');") == "TypeError: echoUint64(): value: expected uint64, got string");
    }

    TEST_CASE("floats keep their precision")
    {
        Fixture f;
        // A float32 rounds to the nearest float, as Math.fround does.
        CHECK(f.value("globalThis.result = [0.1, 1 / 3, 16777217, 1e-46, -1.5e-45, 3.4028235e38]"
                      "  .every((x) => Object.is(n.echoFloat32(x), Math.fround(x)));")
                  .asBoolean());
        CHECK(f.value("globalThis.result = n.echoFloat32(0.1) !== 0.1;").asBoolean());
        CHECK(f.value("globalThis.result = Object.is(n.echoFloat32(-0), -0);").asBoolean());
        CHECK(f.value("globalThis.result = Number.isNaN(n.echoFloat32(NaN));").asBoolean());
        CHECK(f.value("globalThis.result = n.echoFloat32(-Infinity) === -Infinity;").asBoolean());
        CHECK(f.error("n.echoFloat32(3.4028235677973366e38);")
              == "RangeError: echoFloat32(): value: 3.4028235677973366e+38 is out of range for float32");
        CHECK(f.error("n.echoFloat32(-1e300);")
              == "RangeError: echoFloat32(): value: -1e+300 is out of range for float32");
        CHECK(f.error("n.echoFloat32(1n);") == "TypeError: echoFloat32(): value: expected float32, got bigint");
        // A float64 is exact.
        CHECK(f.value("const v = n.echoNumbers(numbers({ f64: 0.1 + 0.2, f32: 0.1 }));"
                      "globalThis.result = v.f64 === 0.1 + 0.2 && v.f32 === Math.fround(0.1);")
                  .asBoolean());
        CHECK(f.value("globalThis.result = n.echoNumbers(numbers({ f64: Number.MIN_VALUE })).f64"
                      "  === Number.MIN_VALUE;")
                  .asBoolean());
        CHECK(f.error("n.echoNumbers(numbers({ f64: '1' }));")
              == "TypeError: echoNumbers(): numbers.f64: expected float64, got string");
    }

    TEST_CASE("nullable values take null, never undefined")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = n.solo();").isNull());
        REQUIRE(f.run("n.setSolo(3); globalThis.result = 0;").ok());
        CHECK(f.api->soloSlot == 3);
        CHECK(f.value("globalThis.result = n.solo();").asNumber() == 3);
        REQUIRE(f.run("n.setSolo(null); globalThis.result = 0;").ok());
        CHECK_FALSE(f.api->soloSlot.has_value());
        CHECK(f.error("n.setSolo(undefined);") == "TypeError: setSolo(): slot: expected int32, got undefined");
        CHECK(f.error("n.setSolo();") == "TypeError: setSolo() expects 1 argument, got 0");
        CHECK(f.error("n.setSolo(1.5);") == "TypeError: setSolo(): slot: expected an integer (int32), got 1.5");
        CHECK(f.error("n.add(null, 1);") == "TypeError: add(): a: expected int32, got null");

        // Struct fields.
        CHECK(f.shown("n.echoOptionals(optionals())")
              == R"({"slot":null,"id":null,"name":null,"curve":null,"point":null,"gains":null,"samples":null})");
        CHECK(f.shown("n.echoOptionals({ slot: -1, id: 2n ** 64n - 1n, name: '', curve: 'low-cut',"
                      "  point: { x: 1, y: 2 }, gains: [], samples: new Float32Array([0.5]) })")
              == R"({"slot":-1,"id":"18446744073709551615n","name":"","curve":"low-cut",)"
                 R"("point":{"x":1,"y":2},"gains":[],"samples":"Float32Array[0.5]"})");
        CHECK(f.error("n.echoOptionals(optionals({ point: undefined }));")
              == "TypeError: echoOptionals(): optionals.point: expected object, got undefined");
        CHECK(f.error("const o = optionals(); delete o.name; n.echoOptionals(o);")
              == "TypeError: echoOptionals(): optionals.name: expected string, got undefined");
        CHECK(f.error("n.echoNumbers(numbers({ i8: null }));")
              == "TypeError: echoNumbers(): numbers.i8: expected int8, got null");

        // Arrays and buffers.
        CHECK(f.value("globalThis.result = n.firstPoint(null);").isNull());
        CHECK(f.value("globalThis.result = n.firstPoint([]);").isNull());
        CHECK(f.shown("n.firstPoint([{ x: 1, y: 2 }, { x: 3, y: 4 }])") == R"({"x":1,"y":2})");
        CHECK(f.value("globalThis.result = n.sumWords(null);").isNull());
        CHECK(f.shown("n.sumWords(new BigUint64Array([1n, 2n ** 63n]))") == R"("9223372036854775809n")");
        CHECK(f.shown("n.sumWords(new BigUint64Array(0))") == R"("0n")");
        CHECK(f.error("n.sumWords([1n]);") == "TypeError: sumWords(): values: expected BigUint64Array, got array");
    }

    TEST_CASE("arrays are values: primitives, enums and structs")
    {
        Fixture f;
        CHECK(f.shown("n.analyze(new Float32Array([1, -1]))")
              == R"({"rms":1,"peak":1,"label":"analysed 2","clipped":true,"curve":"low-cut",)"
                 R"("points":[{"x":1,"y":2},{"x":3,"y":4}],"tags":["a","b"]})");
        CHECK(f.value("globalThis.result = n.invert('linear');").asString() == "exponential");
        CHECK(f.shown("n.centroid([{ x: 0, y: 0 }, { x: 2, y: 4 }])") == R"({"x":1,"y":2})");
        CHECK(f.value("globalThis.result = n.joinTags(['x', 'y', 'z']);").asString() == "x,y,z");
        CHECK(f.value("globalThis.result = n.joinTags([]);").asString().empty());
        CHECK(f.shown("n.curves()") == R"(["low-cut","linear"])");
        CHECK(f.value("globalThis.result = Array.isArray(n.analyze(new Float32Array(1)).points);").asBoolean());
        CHECK(f.error("n.joinTags(new Float32Array(1));")
              == "TypeError: joinTags(): tags: expected array, got typed array");
        CHECK(f.error("n.centroid([1]);") == "TypeError: centroid(): points[0]: expected object, got number");

        REQUIRE(f.run("n.applyPreset({ name: 'warm', gains: [0.1, 2] }); globalThis.result = 0;").ok());
        const native::Preset applied = f.api->applied.value_or(native::Preset {});
        CHECK(applied.name == "warm");
        CHECK(applied.gains == std::vector<float> { 0.1F, 2.0F });
        CHECK(f.error("n.applyPreset({ name: 'warm', gains: new Float32Array(1) });")
              == "TypeError: applyPreset(): preset.gains: expected array, got typed array");
        CHECK(f.error("n.applyPreset({ name: 'warm', gains: [1, 'loud'] });")
              == "TypeError: applyPreset(): preset.gains[1]: expected float32, got string");
    }

    TEST_CASE("buffers of every numeric type")
    {
        Fixture f;
        CHECK(f.shown("n.echoBuffers(buffers())")
              == R"({"i8":"Int8Array[]","u8":"Uint8Array[]","i16":"Int16Array[]","u16":"Uint16Array[]",)"
                 R"("i32":"Int32Array[]","u32":"Uint32Array[]","i64":"BigInt64Array[]","u64":"BigUint64Array[]",)"
                 R"("f32":"Float32Array[]","f64":"Float64Array[]"})");
        CHECK(f.shown("n.echoBuffers({"
                      "  i8: new Int8Array([-128, 127]), u8: new Uint8Array([0, 255]),"
                      "  i16: new Int16Array([-32768, 32767]), u16: new Uint16Array([0, 65535]),"
                      "  i32: new Int32Array([-2147483648, 2147483647]), u32: new Uint32Array([0, 4294967295]),"
                      "  i64: new BigInt64Array([-(2n ** 63n), 2n ** 63n - 1n]),"
                      "  u64: new BigUint64Array([0n, 2n ** 64n - 1n]),"
                      "  f32: new Float32Array([0.1, -Infinity]), f64: new Float64Array([0.1, Number.MAX_VALUE]) })")
              == R"({"i8":"Int8Array[-128,127]","u8":"Uint8Array[0,255]","i16":"Int16Array[-32768,32767]",)"
                 R"("u16":"Uint16Array[0,65535]","i32":"Int32Array[-2147483648,2147483647]",)"
                 R"("u32":"Uint32Array[0,4294967295]",)"
                 R"("i64":"BigInt64Array[-9223372036854775808,9223372036854775807]",)"
                 R"("u64":"BigUint64Array[0,18446744073709551615]",)"
                 R"("f32":"Float32Array[0.10000000149011612,-Infinity]",)"
                 R"("f64":"Float64Array[0.1,1.7976931348623157e+308]"})");
        // Each result owns a buffer of exactly its elements, apart from the
        // argument's.
        CHECK(f.value("const input = buffers({ i16: new Int16Array([1, 2, 3]), u64: new BigUint64Array([1n]) });"
                      "const output = n.echoBuffers(input);"
                      "globalThis.result = output.i16.byteLength === 6 && output.i16.buffer.byteLength === 6"
                      "  && output.u64.byteLength === 8 && output.i16.buffer !== input.i16.buffer;")
                  .asBoolean());
        // A struct field is copied: changing the argument afterwards changes nothing.
        CHECK(f.shown("(() => { const input = buffers({ f64: new Float64Array([1, 2]) });"
                      "  const output = n.echoBuffers(input); input.f64[0] = 9; return output.f64; })()")
              == R"("Float64Array[1,2]")");

        CHECK(f.error("n.echoBuffers(buffers({ i16: new Uint16Array(1) }));")
              == "TypeError: echoBuffers(): buffers.i16: expected Int16Array, got typed array");
        CHECK(f.error("n.echoBuffers(buffers({ u8: new Uint8ClampedArray(1) }));")
              == "TypeError: echoBuffers(): buffers.u8: expected Uint8Array, got typed array");
        CHECK(f.error("n.echoBuffers(buffers({ u8: new ArrayBuffer(1) }));")
              == "TypeError: echoBuffers(): buffers.u8: expected Uint8Array, got ArrayBuffer");
        CHECK(f.error("n.echoBuffers(buffers({ i64: [1n] }));")
              == "TypeError: echoBuffers(): buffers.i64: expected BigInt64Array, got array");
        CHECK(f.error("n.echoBuffers(buffers({ f32: new DataView(new ArrayBuffer(4)) }));").find("TypeError") == 0);
    }

    TEST_CASE("borrows buffer arguments without copying")
    {
        Fixture f;
        CHECK(f.value("globalThis.result = n.sumBytes(new Uint8Array([1, 2, 3, 250]));").asNumber() == 256);
        CHECK(f.shown("n.sumInts(new Int32Array([-5, 10, 20]))") == R"("25n")");
        // A view into the middle of a larger buffer sees only its own elements.
        CHECK(f.shown("n.sumInts(new Int32Array([100, 1, 2, 100]).subarray(1, 3))") == R"("3n")");
        CHECK(f.value("globalThis.result = n.analyze(new Float32Array([0.5, -1, 0.5])).peak;").asNumber() == 1);
        CHECK(f.error("const array = new Int32Array(2); array.buffer.transfer(); n.sumInts(array);").find("TypeError")
              == 0);
        CHECK(f.value("globalThis.result = n.sumBytes(new Uint8Array(0));").asNumber() == 0);
        CHECK(f.error("n.sumBytes(new Uint8Array([1]).buffer);")
              == "TypeError: sumBytes(): data: expected Uint8Array, got ArrayBuffer");
    }

    TEST_CASE("returns buffers JavaScript owns")
    {
        Fixture f;
        CHECK(f.shown("n.makeRamp(4)") == R"("Float32Array[0,1,2,3]")");
        CHECK(f.shown("n.getSpectrum()") == R"("Float32Array[0.25,0.5,1]")");
        CHECK(f.shown("n.scale(new Float64Array([1, 2]), 1.5)") == R"("Float64Array[1.5,3]")");
        CHECK(f.shown("n.reverseBytes(new Uint8Array([1, 2, 3]))") == R"("Uint8Array[3,2,1]")");
        CHECK(f.value("globalThis.result = n.makeRamp(0).length;").asNumber() == 0);
        // The buffer survives the call and garbage collection of everything else.
        REQUIRE(f.run("globalThis.kept = n.makeRamp(1000); globalThis.result = 0;").ok());
        f.runtime.collectGarbage();
        CHECK(f.context.evaluateScript("kept[999] + kept.buffer.byteLength").value().asNumber() == 999 + 4000);
        // And keeps its contents, whatever JavaScript does with it.
        CHECK(f.value("const ramp = n.makeRamp(3); ramp[0] = 7;"
                      "globalThis.result = ramp.join(',') + '/' + n.makeRamp(3).join(',');")
                  .asString()
              == "7,1,2/0,1,2");
    }

    TEST_CASE("turns native exceptions into JavaScript errors")
    {
        Fixture f;
        CHECK(f.error("n.fail('disk full');") == "Error: fail(): disk full");
        CHECK(f.value("try { n.fail('x'); } catch (e) { globalThis.result = e instanceof Error; }").asBoolean());
        // The context keeps working afterwards.
        CHECK(f.value("globalThis.result = n.add(1, 1);").asNumber() == 2);
    }

    TEST_CASE("async methods return promises settled later")
    {
        Fixture f;
        REQUIRE(f.run("globalThis.log = [];"
                      "n.loadPreset('later').then((p) => log.push('loaded ' + p.name + ' ' + p.gains.join()));"
                      "globalThis.result = 0;")
                    .ok());
        CHECK(f.context.evaluateScript("log.length").value().asNumber() == 0);
        REQUIRE(f.api->pendingLoads.size() == 1);

        auto [path, promise] = std::move(f.api->pendingLoads.front());
        f.api->pendingLoads.clear();
        CHECK(promise.isPending());
        promise.resolve(native::Preset { .name = path, .gains = { 1.0F } });
        CHECK_FALSE(promise.isPending());
        promise.resolve(std::nullopt); // second settle is a no-op
        f.runtime.runPendingJobs();
        CHECK(f.context.evaluateScript("log.join()").value().asString() == "loaded later 1");
    }

    TEST_CASE("async methods resolve synchronously, with null, reject, and handle void results")
    {
        Fixture f;
        CHECK(f.shown("await n.loadPreset('sync')") == R"({"name":"sync","gains":[0.5,1]})");
        CHECK(f.value("globalThis.result = await n.loadPreset('missing');").isNull());
        CHECK(f.value("globalThis.result = await n.save({ name: 'mine', gains: [] });").isUndefined());
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
        native::Events events;
        {
            js::Runtime runtime;
            js::Context context(runtime);
            native::install(context, api, events);
            REQUIRE(context
                        .evaluateModule(
                            soundor::test::module("import { loadPreset } from 'soundor:native'; loadPreset('later');"),
                            "/x.js")
                        .ok());
        }
        REQUIRE(api->pendingLoads.size() == 1);
        auto& promise = api->pendingLoads.front().second;
        CHECK_FALSE(promise.isPending());
        promise.resolve(native::Preset { .name = "too late", .gains = {} });
        promise.reject("too late");
        api->pendingLoads.clear();
    }

    TEST_CASE("argument validation happens before the promise exists")
    {
        Fixture f;
        CHECK(f.error("n.loadPreset(1);") == "TypeError: loadPreset(): path: expected string, got number");
        CHECK(f.error("n.save({ name: 'x' });") == "TypeError: save(): preset.gains: expected array, got undefined");
    }

    TEST_CASE("each context gets its own API instance")
    {
        js::Runtime runtime;
        js::Context first(runtime);
        js::Context second(runtime);
        auto a = std::make_shared<FixtureApi>();
        auto b = std::make_shared<FixtureApi>();
        native::Events events;
        native::install(first, a, events);
        native::install(second, b, events);
        REQUIRE(first
                    .evaluateModule(soundor::test::module("import { reset } from 'soundor:native'; reset(); reset();"),
                                    "/a.js")
                    .ok());
        REQUIRE(
            second.evaluateModule(soundor::test::module("import { reset } from 'soundor:native'; reset();"), "/b.js")
                .ok());
        CHECK(a->resets == 2);
        CHECK(b->resets == 1);
    }

    TEST_CASE("install requires an implementation")
    {
        js::Runtime runtime;
        js::Context context(runtime);
        native::Events events;
        CHECK_THROWS_AS(native::install(context, nullptr, events), std::invalid_argument);
    }
}
