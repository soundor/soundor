// The native tests' soundor:native fixture: typed C++ bindings of a native API
// with every supported shape, as a C++ runtime would bind one. First written by
// a generator that is gone; maintained by hand now, and not linted.
#pragma once

#include <soundor/js/Context.h>
#include <soundor/js/Streams.h>
#include <soundor/js/Promise.h>
#include <soundor/processor/RustController.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::native
{
    enum class Curve
    {
        Linear, // "linear"
        Exponential, // "exponential"
        LowCut, // "low-cut"
    };

    struct Point
    {
        double x {};
        double y {};
    };

    struct Analysis
    {
        float rms {};
        float peak {};
        std::string label {};
        bool clipped {};
        Curve curve {};
        std::vector<Point> points {};
        std::vector<std::string> tags {};
    };

    struct Buffers
    {
        std::vector<std::int8_t> i8 {};
        std::vector<std::uint8_t> u8 {};
        std::vector<std::int16_t> i16 {};
        std::vector<std::uint16_t> u16 {};
        std::vector<std::int32_t> i32 {};
        std::vector<std::uint32_t> u32 {};
        std::vector<std::int64_t> i64 {};
        std::vector<std::uint64_t> u64 {};
        std::vector<float> f32 {};
        std::vector<double> f64 {};
    };

    struct Numbers
    {
        std::int8_t i8 {};
        std::uint8_t u8 {};
        std::int16_t i16 {};
        std::uint16_t u16 {};
        std::int32_t i32 {};
        std::uint32_t u32 {};
        std::int64_t i64 {};
        std::uint64_t u64 {};
        float f32 {};
        double f64 {};
    };

    struct Optionals
    {
        std::optional<std::int32_t> slot {};
        std::optional<std::uint64_t> id {};
        std::optional<std::string> name {};
        std::optional<Curve> curve {};
        std::optional<Point> point {};
        std::optional<std::vector<float>> gains {};
        std::optional<std::vector<float>> samples {};
    };

    struct Preset
    {
        std::string name {};
        std::vector<float> gains {};
    };

    // The plugin's native API, declared under `native.methods` in
    // soundor.config. Implement it in the plugin and install() it into each
    // JavaScript context; JavaScript calls it through `soundor:native`.
    //
    // Methods run on the UI/message thread and must not block it. Buffer
    // arguments (std::span) view the JavaScript typed array and are only
    // valid until the method returns; everything else is a value of its own.
    // Async methods receive a js::Promise to settle later, on the same thread.
    class NativeApi
    {
    public:
        virtual ~NativeApi() = default;
        virtual std::int32_t add(std::int32_t a, std::int32_t b) = 0;
        virtual Analysis analyze(std::span<const float> samples) = 0;
        virtual void applyPreset(Preset preset) = 0;
        virtual Point centroid(std::vector<Point> points) = 0;
        virtual std::vector<Curve> curves() = 0;
        virtual Buffers echoBuffers(Buffers buffers) = 0;
        virtual float echoFloat32(float value) = 0;
        virtual std::int64_t echoInt64(std::int64_t value) = 0;
        virtual Numbers echoNumbers(Numbers numbers) = 0;
        virtual Optionals echoOptionals(Optionals optionals) = 0;
        virtual std::uint64_t echoUint64(std::uint64_t value) = 0;
        virtual std::uint8_t echoUint8(std::uint8_t value) = 0;
        virtual void fail(std::string message) = 0;
        virtual std::optional<Point> firstPoint(std::optional<std::vector<Point>> points) = 0;
        virtual std::vector<float> getSpectrum() = 0;
        virtual std::string greet(std::string name) = 0;
        virtual Curve invert(Curve curve) = 0;
        virtual bool isEven(std::int32_t value) = 0;
        virtual std::string joinTags(std::vector<std::string> tags) = 0;
        virtual void loadPreset(std::string path, js::Promise<std::optional<Preset>> promise) = 0;
        virtual std::vector<float> makeRamp(std::uint32_t length) = 0;
        virtual void reset() = 0;
        virtual std::vector<std::uint8_t> reverseBytes(std::span<const std::uint8_t> data) = 0;
        virtual void save(Preset preset, js::Promise<void> promise) = 0;
        virtual std::vector<double> scale(std::span<const double> values, double factor) = 0;
        virtual void setSolo(std::optional<std::int32_t> slot) = 0;
        virtual std::optional<std::int32_t> solo() = 0;
        virtual std::uint32_t sumBytes(std::span<const std::uint8_t> data) = 0;
        virtual std::int64_t sumInts(std::span<const std::int32_t> values) = 0;
        virtual std::optional<std::uint64_t> sumWords(std::optional<std::span<const std::uint64_t>> values) = 0;
    };

    // The plugin's native streams, declared under `native.streams` in
    // soundor.config: values the plugin keeps publishing, of which the UI
    // reads the latest (`streams` of `soundor:native`). Keep one per plugin
    // instance and install() it into each JavaScript context.
    //
    // Publish from the audio callback if you like: publish(), and a buffer's
    // buffer() and commit(), take no lock, never allocate and never wait.
    // One thread at a time publishes a stream. The UI takes the newest value
    // at its next tick, never a partly written one; values in between are
    // skipped, not queued, so no UI, or a slow one, costs nothing.
    struct Streams
    {
        js::ValueStream<std::uint64_t> frames;
        js::ValueStream<float> level;
        js::BufferStream<float> spectrum { 8 };
    };

    // Makes `soundor:native` importable in `context`, backed by `api`, and
    // installs the configured feeds. Call before evaluating code that imports
    // it; the context keeps `api` alive, and disconnects when it goes.
    void install(js::Context& context, std::shared_ptr<NativeApi> api, const Streams& streams, std::shared_ptr<processor::RustController> controller = {});

    // The plugin's controller descriptor (@soundor/core's describeController()):
    // these methods, their types, the parameters and the persistent state, as
    // a Rust controller (`soundor::export!(PluginProcessor, PluginController)`)
    // backs them. processor::RustController checks the controller's own
    // against it.
    inline constexpr std::uint8_t controllerDescriptor[] = {
        83, 78, 68, 67, 2, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0,
        1, 5, 0, 0, 0, 67, 117, 114, 118, 101, 3, 0, 0, 0, 6, 0,
        0, 0, 108, 105, 110, 101, 97, 114, 11, 0, 0, 0, 101, 120, 112, 111,
        110, 101, 110, 116, 105, 97, 108, 7, 0, 0, 0, 108, 111, 119, 45, 99,
        117, 116, 0, 5, 0, 0, 0, 80, 111, 105, 110, 116, 2, 0, 0, 0,
        1, 0, 0, 0, 120, 12, 1, 0, 0, 0, 121, 12, 0, 8, 0, 0,
        0, 65, 110, 97, 108, 121, 115, 105, 115, 7, 0, 0, 0, 3, 0, 0,
        0, 114, 109, 115, 11, 4, 0, 0, 0, 112, 101, 97, 107, 11, 5, 0,
        0, 0, 108, 97, 98, 101, 108, 2, 7, 0, 0, 0, 99, 108, 105, 112,
        112, 101, 100, 1, 5, 0, 0, 0, 99, 117, 114, 118, 101, 13, 0, 0,
        0, 0, 6, 0, 0, 0, 112, 111, 105, 110, 116, 115, 14, 13, 1, 0,
        0, 0, 4, 0, 0, 0, 116, 97, 103, 115, 14, 2, 0, 7, 0, 0,
        0, 66, 117, 102, 102, 101, 114, 115, 10, 0, 0, 0, 2, 0, 0, 0,
        105, 56, 15, 3, 2, 0, 0, 0, 117, 56, 15, 4, 3, 0, 0, 0,
        105, 49, 54, 15, 5, 3, 0, 0, 0, 117, 49, 54, 15, 6, 3, 0,
        0, 0, 105, 51, 50, 15, 7, 3, 0, 0, 0, 117, 51, 50, 15, 8,
        3, 0, 0, 0, 105, 54, 52, 15, 9, 3, 0, 0, 0, 117, 54, 52,
        15, 10, 3, 0, 0, 0, 102, 51, 50, 15, 11, 3, 0, 0, 0, 102,
        54, 52, 15, 12, 0, 7, 0, 0, 0, 78, 117, 109, 98, 101, 114, 115,
        10, 0, 0, 0, 2, 0, 0, 0, 105, 56, 3, 2, 0, 0, 0, 117,
        56, 4, 3, 0, 0, 0, 105, 49, 54, 5, 3, 0, 0, 0, 117, 49,
        54, 6, 3, 0, 0, 0, 105, 51, 50, 7, 3, 0, 0, 0, 117, 51,
        50, 8, 3, 0, 0, 0, 105, 54, 52, 9, 3, 0, 0, 0, 117, 54,
        52, 10, 3, 0, 0, 0, 102, 51, 50, 11, 3, 0, 0, 0, 102, 54,
        52, 12, 0, 9, 0, 0, 0, 79, 112, 116, 105, 111, 110, 97, 108, 115,
        7, 0, 0, 0, 4, 0, 0, 0, 115, 108, 111, 116, 16, 7, 2, 0,
        0, 0, 105, 100, 16, 10, 4, 0, 0, 0, 110, 97, 109, 101, 16, 2,
        5, 0, 0, 0, 99, 117, 114, 118, 101, 16, 13, 0, 0, 0, 0, 5,
        0, 0, 0, 112, 111, 105, 110, 116, 16, 13, 1, 0, 0, 0, 5, 0,
        0, 0, 103, 97, 105, 110, 115, 16, 14, 11, 7, 0, 0, 0, 115, 97,
        109, 112, 108, 101, 115, 16, 15, 11, 0, 6, 0, 0, 0, 80, 114, 101,
        115, 101, 116, 2, 0, 0, 0, 4, 0, 0, 0, 110, 97, 109, 101, 2,
        5, 0, 0, 0, 103, 97, 105, 110, 115, 14, 11, 0, 0, 0, 0, 30,
        0, 0, 0, 3, 0, 0, 0, 97, 100, 100, 0, 2, 0, 0, 0, 1,
        0, 0, 0, 97, 7, 1, 0, 0, 0, 98, 7, 7, 7, 0, 0, 0,
        97, 110, 97, 108, 121, 122, 101, 0, 1, 0, 0, 0, 7, 0, 0, 0,
        115, 97, 109, 112, 108, 101, 115, 15, 11, 13, 2, 0, 0, 0, 11, 0,
        0, 0, 97, 112, 112, 108, 121, 80, 114, 101, 115, 101, 116, 0, 1, 0,
        0, 0, 6, 0, 0, 0, 112, 114, 101, 115, 101, 116, 13, 6, 0, 0,
        0, 0, 8, 0, 0, 0, 99, 101, 110, 116, 114, 111, 105, 100, 0, 1,
        0, 0, 0, 6, 0, 0, 0, 112, 111, 105, 110, 116, 115, 14, 13, 1,
        0, 0, 0, 13, 1, 0, 0, 0, 6, 0, 0, 0, 99, 117, 114, 118,
        101, 115, 0, 0, 0, 0, 0, 14, 13, 0, 0, 0, 0, 11, 0, 0,
        0, 101, 99, 104, 111, 66, 117, 102, 102, 101, 114, 115, 0, 1, 0, 0,
        0, 7, 0, 0, 0, 98, 117, 102, 102, 101, 114, 115, 13, 3, 0, 0,
        0, 13, 3, 0, 0, 0, 11, 0, 0, 0, 101, 99, 104, 111, 70, 108,
        111, 97, 116, 51, 50, 0, 1, 0, 0, 0, 5, 0, 0, 0, 118, 97,
        108, 117, 101, 11, 11, 9, 0, 0, 0, 101, 99, 104, 111, 73, 110, 116,
        54, 52, 0, 1, 0, 0, 0, 5, 0, 0, 0, 118, 97, 108, 117, 101,
        9, 9, 11, 0, 0, 0, 101, 99, 104, 111, 78, 117, 109, 98, 101, 114,
        115, 0, 1, 0, 0, 0, 7, 0, 0, 0, 110, 117, 109, 98, 101, 114,
        115, 13, 4, 0, 0, 0, 13, 4, 0, 0, 0, 13, 0, 0, 0, 101,
        99, 104, 111, 79, 112, 116, 105, 111, 110, 97, 108, 115, 0, 1, 0, 0,
        0, 9, 0, 0, 0, 111, 112, 116, 105, 111, 110, 97, 108, 115, 13, 5,
        0, 0, 0, 13, 5, 0, 0, 0, 10, 0, 0, 0, 101, 99, 104, 111,
        85, 105, 110, 116, 54, 52, 0, 1, 0, 0, 0, 5, 0, 0, 0, 118,
        97, 108, 117, 101, 10, 10, 9, 0, 0, 0, 101, 99, 104, 111, 85, 105,
        110, 116, 56, 0, 1, 0, 0, 0, 5, 0, 0, 0, 118, 97, 108, 117,
        101, 4, 4, 4, 0, 0, 0, 102, 97, 105, 108, 0, 1, 0, 0, 0,
        7, 0, 0, 0, 109, 101, 115, 115, 97, 103, 101, 2, 0, 10, 0, 0,
        0, 102, 105, 114, 115, 116, 80, 111, 105, 110, 116, 0, 1, 0, 0, 0,
        6, 0, 0, 0, 112, 111, 105, 110, 116, 115, 16, 14, 13, 1, 0, 0,
        0, 16, 13, 1, 0, 0, 0, 11, 0, 0, 0, 103, 101, 116, 83, 112,
        101, 99, 116, 114, 117, 109, 0, 0, 0, 0, 0, 15, 11, 5, 0, 0,
        0, 103, 114, 101, 101, 116, 0, 1, 0, 0, 0, 4, 0, 0, 0, 110,
        97, 109, 101, 2, 2, 6, 0, 0, 0, 105, 110, 118, 101, 114, 116, 0,
        1, 0, 0, 0, 5, 0, 0, 0, 99, 117, 114, 118, 101, 13, 0, 0,
        0, 0, 13, 0, 0, 0, 0, 6, 0, 0, 0, 105, 115, 69, 118, 101,
        110, 0, 1, 0, 0, 0, 5, 0, 0, 0, 118, 97, 108, 117, 101, 7,
        1, 8, 0, 0, 0, 106, 111, 105, 110, 84, 97, 103, 115, 0, 1, 0,
        0, 0, 4, 0, 0, 0, 116, 97, 103, 115, 14, 2, 2, 10, 0, 0,
        0, 108, 111, 97, 100, 80, 114, 101, 115, 101, 116, 1, 1, 0, 0, 0,
        4, 0, 0, 0, 112, 97, 116, 104, 2, 16, 13, 6, 0, 0, 0, 8,
        0, 0, 0, 109, 97, 107, 101, 82, 97, 109, 112, 0, 1, 0, 0, 0,
        6, 0, 0, 0, 108, 101, 110, 103, 116, 104, 8, 15, 11, 5, 0, 0,
        0, 114, 101, 115, 101, 116, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0,
        114, 101, 118, 101, 114, 115, 101, 66, 121, 116, 101, 115, 0, 1, 0, 0,
        0, 4, 0, 0, 0, 100, 97, 116, 97, 15, 4, 15, 4, 4, 0, 0,
        0, 115, 97, 118, 101, 1, 1, 0, 0, 0, 6, 0, 0, 0, 112, 114,
        101, 115, 101, 116, 13, 6, 0, 0, 0, 0, 5, 0, 0, 0, 115, 99,
        97, 108, 101, 0, 2, 0, 0, 0, 6, 0, 0, 0, 118, 97, 108, 117,
        101, 115, 15, 12, 6, 0, 0, 0, 102, 97, 99, 116, 111, 114, 12, 15,
        12, 7, 0, 0, 0, 115, 101, 116, 83, 111, 108, 111, 0, 1, 0, 0,
        0, 4, 0, 0, 0, 115, 108, 111, 116, 16, 7, 0, 4, 0, 0, 0,
        115, 111, 108, 111, 0, 0, 0, 0, 0, 16, 7, 8, 0, 0, 0, 115,
        117, 109, 66, 121, 116, 101, 115, 0, 1, 0, 0, 0, 4, 0, 0, 0,
        100, 97, 116, 97, 15, 4, 8, 7, 0, 0, 0, 115, 117, 109, 73, 110,
        116, 115, 0, 1, 0, 0, 0, 6, 0, 0, 0, 118, 97, 108, 117, 101,
        115, 15, 7, 9, 8, 0, 0, 0, 115, 117, 109, 87, 111, 114, 100, 115,
        0, 1, 0, 0, 0, 6, 0, 0, 0, 118, 97, 108, 117, 101, 115, 16,
        15, 10, 16, 10, 3, 0, 0, 0, 6, 0, 0, 0, 108, 101, 118, 101,
        108, 115, 2, 0, 0, 0, 6, 0, 0, 0, 118, 97, 108, 117, 101, 115,
        15, 11, 5, 0, 0, 0, 99, 117, 114, 118, 101, 13, 0, 0, 0, 0,
        12, 0, 0, 0, 112, 114, 101, 115, 101, 116, 76, 111, 97, 100, 101, 100,
        2, 0, 0, 0, 4, 0, 0, 0, 112, 97, 116, 104, 2, 6, 0, 0,
        0, 112, 114, 101, 115, 101, 116, 16, 13, 6, 0, 0, 0, 5, 0, 0,
        0, 114, 101, 97, 100, 121, 0, 0, 0, 0,
    };

    // Installs the native events and the methods backed by the plugin's Rust controller
    // (one per plugin instance, shared by its editors) rather than a NativeApi:
    // the engine converts arguments and results as these bindings do, runs
    // async methods on the controller's worker, and settles their promises
    // when the controller is pumped. What the context started is cancelled
    // when it goes.
    void installController(js::Context& context, std::shared_ptr<processor::RustController> controller, const Streams& streams);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::native
