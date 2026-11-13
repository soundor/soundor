// The `channels` of the generated `soundor:native` (tests/generated, from the
// fixture in src/native-codegen.test.ts): latest values published by native
// code on any one thread, taken by js::deliverChannels() on the context's.

#include "../support/Modules.h"

#include <soundor/js/Channels.h>
#include <soundor/js/Context.h>
#include <soundor/native/SoundorNative.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <array>
#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace soundor;

namespace
{
    class Methods final : public native::NativeApi
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

    struct Fixture
    {
        explicit Fixture(native::Channels& source, const js::RuntimeOptions& options = {}) : runtime(options)
        {
            native::install(context, std::make_shared<Methods>(), events, source);
        }

        void run(const std::string& body)
        {
            const auto evaluated =
                context.evaluateModule(soundor::test::module(std::string("import { channels } from 'soundor:native';\n"
                                                                         "globalThis.channels = channels;\n")
                                                             + body),
                                       "/test" + std::to_string(++counter) + ".js");
            REQUIRE_MESSAGE(evaluated.ok(), (evaluated.ok() ? "" : evaluated.error().toString()));
        }

        std::string text(const std::string& expression)
        {
            const auto value = context.evaluateScript("String(" + expression + ")");
            REQUIRE_MESSAGE(value.ok(), (value.ok() ? "" : value.error().toString()));
            return value.value().asString();
        }

        double number(const std::string& expression)
        {
            const auto value = context.evaluateScript(expression);
            REQUIRE_MESSAGE(value.ok(), (value.ok() ? "" : value.error().toString()));
            return value.value().asNumber();
        }

        native::Events events;
        js::Runtime runtime;
        js::Context context { runtime };
        int counter = 0;
    };

    void publishRamp(native::Channels& channels, std::size_t length, float start)
    {
        std::array<float, 8> values {};
        for (std::size_t index = 0; index < length; ++index)
            values.at(index) = start + static_cast<float>(index);
        REQUIRE(channels.spectrum.publish(std::span<const float>(values.data(), length)));
    }
} // namespace

TEST_SUITE("soundor:native channels")
{
    TEST_CASE("exports one frozen channel per declaration, without a value at first")
    {
        native::Channels source;
        Fixture f(source);
        f.run("globalThis.names = Object.keys(channels).sort().join();");
        CHECK(f.text("names") == "frames,level,spectrum");
        CHECK(f.text("Object.isFrozen(channels) && Object.isFrozen(channels.level)") == "true");
        CHECK(f.text("channels.level.get()") == "undefined");
        CHECK(f.text("channels.spectrum.get()") == "undefined");
        CHECK(f.text("(() => { try { channels.level.subscribe(null); } catch (e) { return e.name + ': ' + e.message; "
                     "} })()")
              == "TypeError: channels.level.subscribe() expects a function, got null");
        CHECK(js::deliverChannels(f.context) == 0);
    }

    TEST_CASE("delivers the newest value once, with its sequence number")
    {
        native::Channels source;
        Fixture f(source);
        f.run("globalThis.log = []; channels.level.subscribe((value, sequence) => log.push(value + '@' + sequence));");
        source.level.publish(0.25F);
        source.level.publish(0.5F);
        source.level.publish(0.75F);
        // Nothing runs JavaScript before the context's own thread delivers.
        CHECK(f.text("log.join()").empty());
        CHECK(f.text("channels.level.get()") == "undefined");
        CHECK(js::deliverChannels(f.context) == 1);
        // The two before were coalesced: the sequence says how many.
        CHECK(f.text("log.join()") == "0.75@3");
        CHECK(f.number("channels.level.get()") == 0.75);
        CHECK(js::deliverChannels(f.context) == 0);
        source.level.publish(1.0F);
        CHECK(js::deliverChannels(f.context) == 1);
        CHECK(f.text("log.join()") == "0.75@3,1@4");
        CHECK(source.level.statistics().published == 4);
        CHECK(source.level.statistics().taken == 2);
    }

    TEST_CASE("buffers arrive as typed arrays of the length published")
    {
        native::Channels source;
        Fixture f(source);
        f.run("globalThis.log = []; channels.spectrum.subscribe((value) => log.push(value.constructor.name + ' ' + "
              "Array.from(value).join('/')));");
        publishRamp(source, 3, 1);
        js::deliverChannels(f.context);
        f.run("globalThis.held = channels.spectrum.get();");
        publishRamp(source, 1, 9);
        js::deliverChannels(f.context);
        // Too long for its storage: nothing is published.
        const std::vector<float> tooLong(9, 1.0F);
        CHECK_FALSE(source.spectrum.publish(tooLong));
        CHECK(js::deliverChannels(f.context) == 0);
        CHECK(f.text("log.join('|')") == "Float32Array 1/2/3|Float32Array 9");
        // A value received earlier is never overwritten by a newer one.
        CHECK(f.text("Array.from(held).join('/')") == "1/2/3");
        CHECK(f.text("channels.spectrum.get() === channels.spectrum.get()") == "true");

        // Written in place, without a copy.
        CHECK(source.spectrum.maxLength() == 8);
        const std::span<float> slot = source.spectrum.buffer();
        REQUIRE(slot.size() == 8);
        slot[0] = 4;
        slot[1] = 5;
        source.spectrum.commit(2);
        publishRamp(source, 0, 0);
        js::deliverChannels(f.context);
        CHECK(f.text("channels.spectrum.get().length") == "0");
        source.spectrum.buffer()[0] = 7;
        source.spectrum.commit(100);
        js::deliverChannels(f.context);
        // A length beyond the storage commits all of it.
        CHECK(f.text("channels.spectrum.get().length") == "8");
        CHECK(f.text("channels.spectrum.get()[0]") == "7");
    }

    TEST_CASE("64-bit integers arrive as bigints, exactly")
    {
        native::Channels source;
        Fixture f(source);
        f.run("");
        source.frames.publish(9007199254740993ULL);
        js::deliverChannels(f.context);
        CHECK(f.text("typeof channels.frames.get()") == "bigint");
        CHECK(f.text("channels.frames.get()") == "9007199254740993");
    }

    TEST_CASE("a UI imported later starts with the value published last")
    {
        native::Channels source;
        source.level.publish(0.1F);
        source.level.publish(0.2F);
        Fixture f(source);
        CHECK(js::deliverChannels(f.context) == 0);
        f.run("globalThis.calls = 0; channels.level.subscribe(() => ++globalThis.calls);");
        // get() has it from the start; subscribers hear only of newer values.
        CHECK(f.number("channels.level.get()") == doctest::Approx(0.2));
        CHECK(js::deliverChannels(f.context) == 0);
        CHECK(f.number("calls") == 0);
        CHECK(f.text("channels.spectrum.get()") == "undefined");
    }

    TEST_CASE("subscribers share a value; unsubscribing stops one; a throw is logged")
    {
        std::vector<std::string> errors;
        js::RuntimeOptions options;
        options.log = [&errors](js::LogLevel level, std::string_view message)
        {
            if (level == js::LogLevel::Error)
                errors.emplace_back(message);
        };
        native::Channels source;
        Fixture f(source, options);
        f.run(R"(
            globalThis.seen = [];
            globalThis.stopFirst = channels.spectrum.subscribe((value) => { seen.push('first'); globalThis.firstValue = value; });
            channels.spectrum.subscribe((value) => { seen.push('second'); globalThis.same = globalThis.firstValue === value; });
            channels.spectrum.subscribe(() => { throw new Error('boom'); });
            channels.spectrum.subscribe((value) => { seen.push('after ' + (value === channels.spectrum.get())); });
        )");
        publishRamp(source, 2, 0);
        js::deliverChannels(f.context);
        CHECK(f.text("seen.join()") == "first,second,after true");
        CHECK(f.text("same") == "true");
        REQUIRE(errors.size() == 1);
        CHECK(errors[0].starts_with("soundor:native channel subscriber threw: Error: boom"));
        f.run("stopFirst(); stopFirst();");
        publishRamp(source, 2, 0);
        js::deliverChannels(f.context);
        CHECK(f.text("seen.join()") == "first,second,after true,second,after true");
    }

    TEST_CASE("every connected context receives the newest value")
    {
        native::Channels source;
        Fixture first(source);
        Fixture second(source);
        first.run("globalThis.log = []; channels.level.subscribe((v, s) => log.push(s));");
        second.run("globalThis.log = []; channels.level.subscribe((v, s) => log.push(s));");
        source.level.publish(1);
        CHECK(js::deliverChannels(first.context) == 1);
        source.level.publish(2);
        CHECK(js::deliverChannels(second.context) == 1);
        CHECK(js::deliverChannels(first.context) == 1);
        CHECK(js::deliverChannels(second.context) == 0);
        CHECK(first.text("log.join()") == "1,2");
        CHECK(second.text("log.join()") == "2");
    }

    TEST_CASE("a UI that does not take values accumulates nothing")
    {
        native::Channels source;
        Fixture f(source);
        f.run("globalThis.count = 0; channels.spectrum.subscribe(() => ++globalThis.count);");
        for (int index = 0; index < 10000; ++index)
            publishRamp(source, 8, static_cast<float>(index));
        CHECK(js::deliverChannels(f.context) == 1);
        CHECK(f.number("count") == 1);
        CHECK(f.number("channels.spectrum.get()[0]") == 9999);
        CHECK(source.spectrum.statistics().published == 10000);
        CHECK(source.spectrum.statistics().taken == 1);
    }

    TEST_CASE("a producer thread never shows the UI a partly written value")
    {
        // Every value is `length` copies of its own number, `length` from 1
        // to 8 following it: a torn read would mix two values or lengths.
        native::Channels source;
        Fixture f(source);
        f.run(R"(
            globalThis.problems = [];
            globalThis.received = 0;
            let last = 0;
            channels.spectrum.subscribe((value, sequence) => {
                ++globalThis.received;
                if (sequence <= last) problems.push('sequence ' + sequence + ' after ' + last);
                last = sequence;
                const number = value[0];
                if (value.length !== (number % 8) + 1) problems.push('length ' + value.length + ' for ' + number);
                for (const element of value) if (element !== number) { problems.push('torn ' + number); break; }
                if (number + 1 !== sequence) problems.push('value ' + number + ' as ' + sequence);
            });
        )");
        constexpr int total = 200000;
        std::atomic<bool> done { false };
        std::thread producer(
            [&source, &done]
            {
                for (int number = 0; number < total; ++number)
                {
                    const std::span<float> slot = source.spectrum.buffer();
                    const std::size_t length = (static_cast<std::size_t>(number) % 8) + 1;
                    for (std::size_t index = 0; index < length; ++index)
                        slot[index] = static_cast<float>(number);
                    source.spectrum.commit(length);
                }
                done.store(true);
            });
        std::size_t delivered = 0;
        while (! done.load())
            delivered += js::deliverChannels(f.context);
        producer.join();
        delivered += js::deliverChannels(f.context);
        CHECK(f.text("problems.slice(0, 5).join('; ')").empty());
        CHECK(f.number("received") == static_cast<double>(delivered));
        // The last value always arrives.
        CHECK(f.number("channels.spectrum.get()[0]") == total - 1);
        CHECK(source.spectrum.statistics().published == total);
    }

    TEST_CASE("the triple buffer alone: every value taken is whole and newer")
    {
        // Without JavaScript, so it runs many more exchanges.
        js::BufferChannel<std::uint32_t> channel(64);
        const auto core = channel.core();
        constexpr std::uint32_t total = 500000;
        std::thread producer(
            [&channel]
            {
                for (std::uint32_t number = 1; number <= total; ++number)
                {
                    const std::span<std::uint32_t> slot = channel.buffer();
                    const std::size_t length = (number % 64) + 1;
                    for (std::size_t index = 0; index < length; ++index)
                        slot[index] = number;
                    channel.commit(length);
                }
            });
        std::uint64_t last = 0;
        std::uint64_t problems = 0;
        while (last < total)
        {
            if (! core->take())
                continue;
            const auto& slot = core->front();
            const auto* data = static_cast<const std::uint32_t*>(slot.data);
            const std::uint32_t number = data[0];
            if (slot.sequence <= last || number != slot.sequence || slot.length != (number % 64) + 1)
                ++problems;
            for (std::size_t index = 0; index < slot.length; ++index)
                if (data[index] != number)
                    ++problems;
            last = slot.sequence;
        }
        producer.join();
        CHECK(problems == 0);
        CHECK(channel.statistics().published == total);
    }

    TEST_CASE("a context going, or the channels going, is clean either way")
    {
        native::Channels source;
        {
            Fixture f(source);
            f.run("channels.level.subscribe(() => {});");
            source.level.publish(1);
            // Destroyed with a value not taken.
        }
        source.level.publish(2);

        auto early = std::make_unique<native::Channels>();
        Fixture f(*early);
        f.run("globalThis.log = []; channels.level.subscribe((v) => log.push(v));");
        early->level.publish(3);
        early.reset();
        // What was published before they went is still delivered.
        CHECK(js::deliverChannels(f.context) == 1);
        CHECK(f.text("log.join()") == "3");
    }

    TEST_CASE("a reloaded UI starts with the latest value")
    {
        native::Channels source;
        auto first = std::make_unique<Fixture>(source);
        first->run("");
        source.level.publish(1);
        js::deliverChannels(first->context);
        source.level.publish(2);
        // Reload: the old context goes before taking 2.
        first.reset();
        Fixture second(source);
        second.run("globalThis.log = []; channels.level.subscribe((v, s) => log.push(v + '@' + s));");
        CHECK(second.number("channels.level.get()") == 2);
        source.level.publish(3);
        js::deliverChannels(second.context);
        CHECK(second.text("log.join()") == "3@3");
    }

    TEST_CASE("RuntimeHost::tick delivers them")
    {
        native::Events events;
        native::Channels source;
        RuntimeHost::Options options;
        options.installModules = [&events, &source](js::Context& context)
        { native::install(context, std::make_shared<Methods>(), events, source); };
        RuntimeHost host(std::move(options));
        REQUIRE(host.context()
                    .evaluateModule(soundor::test::module("import { channels } from 'soundor:native';"
                                                          "globalThis.values = [];"
                                                          "channels.level.subscribe((v) => values.push(v));"),
                                    "/ui.js")
                    .ok());
        source.level.publish(0.5F);
        source.level.publish(1);
        host.tick();
        host.tick();
        CHECK(host.context().evaluateScript("values.join()").value().asString() == "1");
    }
}
