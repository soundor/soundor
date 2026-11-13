// soundor_channel_benchmark: what latest-value channels (js/Channels.h) cost,
// between a producer thread publishing at a fixed rate, as an audio callback
// does, and a UI thread ticking at 60 Hz and delivering to a JavaScript
// subscriber, as RuntimeHost::tick does.
//
//   soundor_channel_benchmark            every scenario, 2 s each
//   soundor_channel_benchmark --quick    every scenario, briefly (ctest)
//
// For each producer rate, value size and UI speed it reports what publishing
// costs (writing the value included) and whether it allocated (it must not),
// what delivering costs (taking the value, its copy into JavaScript and a
// subscriber that reads its first and last element), the latency from a
// publication to its subscriber, and how many values were delivered and
// coalesced. It fails if a publication allocated or a value arrived torn
// (tests/native/NativeChannelsTests.cpp checks every element).

#include "js/Bindings.h"
#include "js/Internal.h"

#include <soundor/js/Channels.h>
#include <soundor/js/Context.h>
#include <soundor/js/Runtime.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

using namespace soundor;
namespace bind = soundor::js::bind;
using Clock = std::chrono::steady_clock;

// ── Allocations, counted on the threads that ask ────────────────────────────

namespace
{
    thread_local bool countAllocations = false;
    std::atomic<std::uint64_t> counted { 0 };
} // namespace

void* operator new(std::size_t size)
{
    if (countAllocations)
        counted.fetch_add(1, std::memory_order_relaxed);
    if (void* memory = std::malloc(size == 0 ? 1 : size))
        return memory;
    throw std::bad_alloc();
}

void operator delete(void* memory) noexcept
{
    std::free(memory);
}

void operator delete(void* memory, std::size_t) noexcept
{
    std::free(memory);
}

void* operator new[](std::size_t size)
{
    return operator new(size);
}

void operator delete[](void* memory) noexcept
{
    std::free(memory);
}

void operator delete[](void* memory, std::size_t) noexcept
{
    std::free(memory);
}

namespace
{
    // ── A module of one channel, as generated code installs it ───────────────

    const char channelsKey = 0;
    constexpr std::array<const char*, 1> channelNames { "value" };

    void install(js::Context& context, const js::Channel& channel)
    {
        bind::connectChannels(context, { channel.core() }, &channelsKey);
        js::registerNativeModule(context, "soundor:native",
                                 {
                                     [](bind::ContextState& ctx, jsi::Object& exports)
                                     { bind::installChannels(ctx, exports, channelNames, &channelsKey); },
                                     {},
                                     {},
                                 });
    }

    // ── Scenarios ────────────────────────────────────────────────────────────

    struct Scenario
    {
        double rate = 60;        // publications a second
        std::size_t length = 0;  // 0: one number (a ValueChannel)
        double uiRate = 60;      // ticks a second
        double subscriberMs = 0; // what the subscriber spends on a value
    };

    struct Result
    {
        std::uint64_t published = 0;
        std::uint64_t delivered = 0;
        std::uint64_t allocations = 0;
        std::uint64_t torn = 0;
        double publishNs = 0; // mean
        double publishMaxNs = 0;
        double deliverUs = 0; // mean, per tick that delivered
        double latencyP50Ms = 0;
        double latencyP99Ms = 0;
    };

    double percentile(std::vector<double> values, double fraction)
    {
        if (values.empty())
            return 0;
        std::ranges::sort(values);
        const auto index = static_cast<std::size_t>(fraction * static_cast<double>(values.size() - 1));
        return values[index];
    }

    // Commit times by sequence number, written by the producer before it
    // commits, read by the UI after taking that value.
    constexpr std::size_t maxPublications = 1 << 16;

    template <typename Channel>
    Result run(const Scenario& scenario, Channel& channel, double seconds)
    {
        js::Runtime runtime;
        js::Context context(runtime);
        install(context, channel);
        const std::string check = scenario.length == 0 ? "if (typeof value !== 'number') ++globalThis.torn;"
                                                       : "if (value[0] !== value[value.length - 1]) ++globalThis.torn;";
        const std::string body = "const { channels } = require('soundor:native'); globalThis.torn = 0;"
                                 "channels.value.subscribe((value) => {"
                                 + check + "const until = Date.now() + " + std::to_string(scenario.subscriberMs)
                                 + "; while (Date.now() < until) {} });";
        const auto evaluated = context.evaluateModule("(function (exports, require) {" + body + "})", "/ui.js");
        if (! evaluated.ok())
            throw std::runtime_error(evaluated.error().toString());

        auto committedAt = std::make_unique<std::array<std::atomic<std::int64_t>, maxPublications>>();
        std::atomic<bool> stop { false };
        std::atomic<std::uint64_t> allocations { 0 };
        std::vector<double> publishTimes;
        publishTimes.reserve(maxPublications);

        std::thread producer(
            [&]
            {
                const auto period = std::chrono::duration<double>(1.0 / scenario.rate);
                auto next = Clock::now();
                std::uint64_t number = 0;
                const std::uint64_t before = counted.load();
                while (! stop.load(std::memory_order_relaxed) && number + 1 < maxPublications)
                {
                    ++number;
                    const auto start = Clock::now();
                    committedAt->at(number).store(start.time_since_epoch().count(), std::memory_order_relaxed);
                    countAllocations = true;
                    if constexpr (requires { channel.buffer(); })
                    {
                        const std::span<float> slot = channel.buffer();
                        std::fill_n(slot.begin(), scenario.length, static_cast<float>(number));
                        channel.commit(scenario.length);
                    }
                    else
                        channel.publish(static_cast<float>(number));
                    countAllocations = false;
                    publishTimes.push_back(std::chrono::duration<double, std::nano>(Clock::now() - start).count());
                    next += std::chrono::duration_cast<Clock::duration>(period);
                    std::this_thread::sleep_until(next);
                }
                allocations.store(counted.load() - before);
            });

        Result result;
        std::vector<double> latencies;
        double deliverTotal = 0;
        std::uint64_t deliveringTicks = 0;
        const auto end =
            Clock::now() + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(seconds));
        const auto tick =
            std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(1.0 / scenario.uiRate));
        auto nextTick = Clock::now();
        const auto core = channel.core();
        while (Clock::now() < end)
        {
            const auto start = Clock::now();
            const std::size_t delivered = js::deliverChannels(context);
            const auto done = Clock::now();
            if (delivered > 0)
            {
                result.delivered += delivered;
                ++deliveringTicks;
                deliverTotal += std::chrono::duration<double, std::micro>(done - start).count();
                const std::uint64_t sequence = core->front().sequence;
                const Clock::time_point committed(Clock::duration(committedAt->at(sequence).load()));
                latencies.push_back(std::chrono::duration<double, std::milli>(done - committed).count());
            }
            nextTick += tick;
            std::this_thread::sleep_until(std::max(nextTick, Clock::now()));
        }
        stop.store(true);
        producer.join();

        result.published = channel.statistics().published;
        result.allocations = allocations.load();
        result.torn = static_cast<std::uint64_t>(context.evaluateScript("globalThis.torn").value().asNumber());
        if (! publishTimes.empty())
        {
            double total = 0;
            for (double time : publishTimes)
                total += time;
            result.publishNs = total / static_cast<double>(publishTimes.size());
            result.publishMaxNs = *std::ranges::max_element(publishTimes);
        }
        result.deliverUs = deliveringTicks > 0 ? deliverTotal / static_cast<double>(deliveringTicks) : 0;
        result.latencyP50Ms = percentile(latencies, 0.5);
        result.latencyP99Ms = percentile(latencies, 0.99);
        return result;
    }

    std::string describe(const Scenario& scenario)
    {
        std::string value =
            scenario.length == 0 ? "float32" : "buffer<float32>[" + std::to_string(scenario.length) + "]";
        std::string ui = std::to_string(static_cast<int>(scenario.uiRate)) + " Hz";
        if (scenario.subscriberMs > 0)
            ui += ", " + std::to_string(static_cast<int>(scenario.subscriberMs)) + " ms subscriber";
        char line[160];
        std::snprintf(line, sizeof line, "%6.0f Hz  %-22s %-24s", scenario.rate, value.c_str(), ui.c_str());
        return line;
    }
} // namespace

int main(int argc, char** argv)
try
{
    const bool quick = argc > 1 && std::string_view(argv[1]) == "--quick";
    const double seconds = quick ? 0.25 : 2.0;

    std::vector<Scenario> scenarios;
    for (const double rate : { 60.0, 120.0, 375.0 })
        for (const std::size_t length : { std::size_t { 0 }, std::size_t { 256 }, std::size_t { 2048 } })
            scenarios.push_back({ .rate = rate, .length = length });
    // A UI slower than the producer: ticking at 15 Hz, or a subscriber that
    // takes 30 ms on each value.
    scenarios.push_back({ .rate = 375, .length = 2048, .uiRate = 15 });
    scenarios.push_back({ .rate = 375, .length = 2048, .subscriberMs = 30 });

    std::printf("%-55s %10s %10s %9s %9s %8s %10s %10s %10s %6s\n", "producer  value                  UI", "published",
                "delivered", "coalesced", "pub ns", "pub max", "deliver us", "lat p50 ms", "lat p99 ms", "allocs");
    bool failed = false;
    for (const Scenario& scenario : scenarios)
    {
        Result result;
        if (scenario.length == 0)
        {
            js::ValueChannel<float> channel;
            result = run(scenario, channel, seconds);
        }
        else
        {
            js::BufferChannel<float> channel(scenario.length);
            result = run(scenario, channel, seconds);
        }
        std::printf("%-55s %10llu %10llu %9llu %9.0f %8.0f %10.1f %10.2f %10.2f %6llu\n", describe(scenario).c_str(),
                    static_cast<unsigned long long>(result.published),
                    static_cast<unsigned long long>(result.delivered),
                    static_cast<unsigned long long>(result.published - result.delivered), result.publishNs,
                    result.publishMaxNs, result.deliverUs, result.latencyP50Ms, result.latencyP99Ms,
                    static_cast<unsigned long long>(result.allocations));
        if (result.allocations > 0 || result.torn > 0 || result.delivered == 0)
        {
            std::fprintf(stderr, "FAILED: %llu allocations while publishing, %llu torn values, %llu delivered\n",
                         static_cast<unsigned long long>(result.allocations),
                         static_cast<unsigned long long>(result.torn),
                         static_cast<unsigned long long>(result.delivered));
            failed = true;
        }
    }
    return failed ? 1 : 0;
}
catch (const std::exception& error)
{
    std::fprintf(stderr, "%s\n", error.what());
    return 2;
}
