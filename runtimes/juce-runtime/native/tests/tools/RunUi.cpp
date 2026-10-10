// soundor_run_ui: runs a plugin UI bundle headless, on the GPU, the way the
// generated editor would, and reports what its frames cost. For benchmarks
// (examples/benchmark) and for looking at a UI without building a plugin.
//
//   soundor_run_ui <ui directory> [--size 800x600] [--scale 1] [--seconds N]
//                  [--eval <expression>] [--backend <name>] [--software]
//                  [--json <file>] [--time-native-calls]
//
// <ui directory> is a built bundle (.soundor/ui/production after
// `soundor build web`). With --eval, the expression is evaluated once the UI
// has started; if it is a promise, the run lasts until it settles (or
// --seconds pass: 600 by default, 10 without --eval) and its value is printed
// as JSON. --backend picks ANGLE's backend (vulkan, opengl, metal, d3d11);
// by default it is the editor's, and on Linux without Vulkan, OpenGL. Frames
// are made and composited as fast as they come, on an offscreen GPU
// compositor sharing the UI's device, so WebGL is composited without copies,
// as in a plugin. What the UI logs goes to stderr.
//
// Every frame is timed in three parts: tick() (timers, animation frame
// callbacks: the UI's JavaScript and the WebGL calls it makes), frame()
// (layout, CPU rasterization, layers) and compositing. Nothing waits for the
// GPU, so these are CPU times. A UI can name what it is doing by setting
// `globalThis.soundorRunUiPhase` to a string (empty or unset: no phase); the
// frames are then also reported per phase, in the order the phases appear.
// With each frame come the host's statistics (RuntimeHost::Statistics): the
// steps of tick(), native calls per API, style changes, layout passes,
// invalidations and engine allocations. --time-native-calls also times the
// native calls (a clock read per call). --json writes the report (device,
// value, totals, phases) to a file.

#include "gpu/Device.h"
#include "gpu/OffscreenCompositor.h"

#include <soundor/platform/Resources.h>
#include <soundor/render/GpuCompositor.h>
#include <soundor/runtime/RuntimeHost.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

using namespace soundor;

namespace
{
    using Clock = std::chrono::steady_clock;

    int usage()
    {
        std::cerr << "usage: soundor_run_ui <ui directory> [--size WxH] [--scale S] [--seconds N] [--eval EXPR] "
                     "[--backend vulkan|opengl|metal|d3d11] [--software] [--json FILE] [--time-native-calls]\n";
        return 2;
    }

    double milliseconds(Clock::time_point from, Clock::time_point to)
    {
        return std::chrono::duration<double, std::milli>(to - from).count();
    }

    double milliseconds(std::uint64_t nanoseconds)
    {
        return static_cast<double>(nanoseconds) / 1e6;
    }

    // What one frame cost.
    struct Sample
    {
        double frame = 0; // since the previous frame was composited
        double tick = 0;
        double build = 0;
        double composite = 0;
        int layersRasterized = 0;
        long long pixelsRasterized = 0;
        int gpuReadbacks = 0;
        long long bytesUploaded = 0;
        int textureAllocations = 0;
        int compositorDrawCalls = 0;
        // The steps of tick(), in milliseconds.
        double web = 0;
        double jobs = 0;
        double animationFrames = 0;
        double presentWebGL = 0;
        // Native calls, and their time (with --time-native-calls).
        long long uiCalls = 0;
        long long canvasCalls = 0;
        long long webglCalls = 0;
        double uiCallMs = 0;
        double canvasCallMs = 0;
        double webglCallMs = 0;
        long long styleChanges = 0;
        long long layoutPasses = 0;
        double layoutMs = 0;
        long long invalidations = 0;
        long long allocations = 0;
        long long allocatedBytes = 0;
        long long heapBytes = 0; // at the end of the frame
    };

    // What the host did between `before` and `after`, into `sample`.
    void difference(const RuntimeHost::Statistics& before, const RuntimeHost::Statistics& after, Sample& sample)
    {
        const auto count = [](std::uint64_t from, std::uint64_t to) { return static_cast<long long>(to - from); };
        const auto time = [](std::uint64_t from, std::uint64_t to) { return milliseconds(to - from); };
        sample.web = time(before.tick.web, after.tick.web);
        sample.jobs = time(before.tick.jobs, after.tick.jobs);
        sample.animationFrames = time(before.tick.animationFrames, after.tick.animationFrames);
        sample.presentWebGL = time(before.tick.presentWebGL, after.tick.presentWebGL);
        sample.uiCalls = count(before.runtime.ui.calls, after.runtime.ui.calls);
        sample.canvasCalls = count(before.runtime.canvas.calls, after.runtime.canvas.calls);
        sample.webglCalls = count(before.runtime.webgl.calls, after.runtime.webgl.calls);
        sample.uiCallMs = time(before.runtime.ui.nanoseconds, after.runtime.ui.nanoseconds);
        sample.canvasCallMs = time(before.runtime.canvas.nanoseconds, after.runtime.canvas.nanoseconds);
        sample.webglCallMs = time(before.runtime.webgl.nanoseconds, after.runtime.webgl.nanoseconds);
        sample.styleChanges = count(before.surface.styleChanges, after.surface.styleChanges);
        sample.layoutPasses = count(before.surface.layoutPasses, after.surface.layoutPasses);
        sample.layoutMs = time(before.surface.layoutNanoseconds, after.surface.layoutNanoseconds);
        sample.invalidations = count(before.surface.invalidations, after.surface.invalidations);
        sample.allocations = count(before.runtime.allocations, after.runtime.allocations);
        sample.allocatedBytes = count(before.runtime.allocatedBytes, after.runtime.allocatedBytes);
        sample.heapBytes = static_cast<long long>(after.runtime.heapBytes);
    }

    struct Phase
    {
        std::string name;
        std::vector<Sample> samples;
        // Every tick in the phase, and those that rendered nothing (a UI that
        // does not change) with their time.
        long long ticks = 0;
        long long idleTicks = 0;
        double idleTickMs = 0;
    };

    struct Distribution
    {
        double mean = 0;
        double p50 = 0;
        double p95 = 0;
        double max = 0;
    };

    Distribution distribution(const std::vector<Sample>& samples, double Sample::*field)
    {
        if (samples.empty())
            return {};
        std::vector<double> values;
        values.reserve(samples.size());
        double sum = 0;
        for (const Sample& sample : samples)
        {
            values.push_back(sample.*field);
            sum += sample.*field;
        }
        std::ranges::sort(values);
        const auto at = [&](double fraction)
        {
            const auto index = static_cast<std::size_t>(std::lround(fraction * static_cast<double>(values.size() - 1)));
            return values[std::min(index, values.size() - 1)];
        };
        return { sum / static_cast<double>(values.size()), at(0.5), at(0.95), values.back() };
    }

    template <typename T>
    long long total(const std::vector<Sample>& samples, T Sample::*field)
    {
        long long sum = 0;
        for (const Sample& sample : samples)
            sum += sample.*field;
        return sum;
    }

    template <typename T>
    double perFrame(const std::vector<Sample>& samples, T Sample::*field)
    {
        if (samples.empty())
            return 0;
        double sum = 0;
        for (const Sample& sample : samples)
            sum += static_cast<double>(sample.*field);
        return sum / static_cast<double>(samples.size());
    }

    long long largest(const std::vector<Sample>& samples, long long Sample::*field)
    {
        long long most = 0;
        for (const Sample& sample : samples)
            most = std::max(most, sample.*field);
        return most;
    }

    double seconds(const std::vector<Sample>& samples)
    {
        double sum = 0;
        for (const Sample& sample : samples)
            sum += sample.frame;
        return sum / 1000;
    }

    std::string jsonString(std::string_view text)
    {
        std::string out = "\"";
        for (const char c : text)
        {
            if (c == '"' || c == '\\')
                out += std::string("\\") + c;
            else if (static_cast<unsigned char>(c) < 0x20)
            {
                std::array<char, 8> escaped {};
                std::snprintf(escaped.data(), escaped.size(), "\\u%04x", static_cast<unsigned>(c));
                out += escaped.data();
            }
            else
                out += c;
        }
        return out + "\"";
    }

    std::string number(double value)
    {
        if (! std::isfinite(value))
            return "0";
        std::ostringstream out;
        out << std::setprecision(10) << value;
        return out.str();
    }

    // `"name": value`, a member of a JSON object.
    std::string field(std::string_view name, const std::string& value)
    {
        return jsonString(name) + ": " + value;
    }

    std::string json(const Distribution& d)
    {
        return "{ \"mean\": " + number(d.mean) + ", \"p50\": " + number(d.p50) + ", \"p95\": " + number(d.p95)
               + ", \"max\": " + number(d.max) + " }";
    }

    std::string json(const Phase& phase)
    {
        const auto& s = phase.samples;
        const double time = seconds(s);
        std::string out = "{ \"name\": " + jsonString(phase.name);
        out += ", \"frames\": " + std::to_string(s.size());
        out += ", \"ticks\": " + std::to_string(phase.ticks);
        out += ", \"idleTicks\": " + std::to_string(phase.idleTicks);
        out += ", \"idleTickMs\": "
               + number(phase.idleTicks > 0 ? phase.idleTickMs / static_cast<double>(phase.idleTicks) : 0);
        out += ", \"seconds\": " + number(time);
        out += ", \"fps\": " + number(time > 0 ? static_cast<double>(s.size()) / time : 0);
        out += ", \"frameMs\": " + json(distribution(s, &Sample::frame));
        out += ", \"tickMs\": " + json(distribution(s, &Sample::tick));
        out += ", \"buildMs\": " + json(distribution(s, &Sample::build));
        out += ", \"compositeMs\": " + json(distribution(s, &Sample::composite));
        out += ", \"layersRasterized\": " + std::to_string(total(s, &Sample::layersRasterized));
        out += ", \"pixelsRasterized\": " + std::to_string(total(s, &Sample::pixelsRasterized));
        out += ", \"gpuReadbacks\": " + std::to_string(total(s, &Sample::gpuReadbacks));
        out += ", \"bytesUploaded\": " + std::to_string(total(s, &Sample::bytesUploaded));
        out += ", \"textureAllocations\": " + std::to_string(total(s, &Sample::textureAllocations));
        out += ", \"compositorDrawCalls\": " + std::to_string(total(s, &Sample::compositorDrawCalls));
        // Per frame, as means.
        const auto mean = [&](auto field) { return number(perFrame(s, field)); };
        out += ", "
               + field("tickSteps", "{ " + field("web", mean(&Sample::web)) + ", " + field("jobs", mean(&Sample::jobs))
                                        + ", " + field("animationFrames", mean(&Sample::animationFrames)) + ", "
                                        + field("presentWebGL", mean(&Sample::presentWebGL)) + " }");
        const auto calls = [&](long long Sample::*count, double Sample::*spent)
        { return "{ " + field("perFrame", mean(count)) + ", " + field("ms", mean(spent)) + " }"; };
        out += ", "
               + field("nativeCalls", "{ " + field("ui", calls(&Sample::uiCalls, &Sample::uiCallMs)) + ", "
                                          + field("canvas", calls(&Sample::canvasCalls, &Sample::canvasCallMs)) + ", "
                                          + field("webgl", calls(&Sample::webglCalls, &Sample::webglCallMs)) + " }");
        out += ", "
               + field("surface", "{ " + field("styleChanges", mean(&Sample::styleChanges)) + ", "
                                      + field("layoutPasses", mean(&Sample::layoutPasses)) + ", "
                                      + field("layoutMs", mean(&Sample::layoutMs)) + ", "
                                      + field("invalidations", mean(&Sample::invalidations)) + " }");
        out += ", "
               + field("engine", "{ " + field("allocations", mean(&Sample::allocations)) + ", "
                                     + field("allocatedBytes", mean(&Sample::allocatedBytes)) + ", "
                                     + field("heapBytesMax", std::to_string(largest(s, &Sample::heapBytes))) + " }");
        return out + " }";
    }

    void describe(const Phase& phase)
    {
        const auto& s = phase.samples;
        const double time = seconds(s);
        const auto mean = [&](double Sample::*field) { return number(distribution(s, field).mean); };
        std::cerr << (phase.name.empty() ? std::string("total") : phase.name) << ": " << s.size() << " frames in "
                  << number(time) << " s (" << number(time > 0 ? static_cast<double>(s.size()) / time : 0)
                  << " fps); frame " << mean(&Sample::frame) << " ms (p95 "
                  << number(distribution(s, &Sample::frame).p95) << "): tick " << mean(&Sample::tick) << ", build "
                  << mean(&Sample::build) << ", composite " << mean(&Sample::composite) << "; "
                  << total(s, &Sample::gpuReadbacks) << " GPU read-backs, " << total(s, &Sample::layersRasterized)
                  << " CPU layers rasterized, " << total(s, &Sample::bytesUploaded) << " bytes uploaded\n"
                  << "  per frame: " << number(perFrame(s, &Sample::uiCalls)) << " ui, "
                  << number(perFrame(s, &Sample::canvasCalls)) << " canvas, "
                  << number(perFrame(s, &Sample::webglCalls)) << " WebGL calls; "
                  << number(perFrame(s, &Sample::styleChanges)) << " style changes, "
                  << number(perFrame(s, &Sample::layoutPasses)) << " layouts, "
                  << number(perFrame(s, &Sample::invalidations)) << " invalidations, "
                  << number(perFrame(s, &Sample::allocations)) << " engine allocations\n";
    }

    std::optional<gpu::Backend> backendNamed(std::string_view name)
    {
        if (name == "vulkan")
            return gpu::Backend::Vulkan;
        if (name == "opengl")
            return gpu::Backend::OpenGL;
        if (name == "metal")
            return gpu::Backend::Metal;
        if (name == "d3d11")
            return gpu::Backend::Direct3D11;
        return std::nullopt;
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc < 2)
        return usage();
    std::string directory = argv[1];
    float width = 800;
    float height = 600;
    float scale = 1;
    std::optional<double> limit;
    std::string expression;
    std::optional<gpu::Backend> backend;
    bool software = false;
    std::string jsonPath;
    bool timeNativeCalls = false;
    for (int i = 2; i < argc; ++i)
    {
        const std::string_view flag = argv[i];
        const bool takesValue = flag != "--software" && flag != "--time-native-calls";
        if (takesValue && i + 1 >= argc)
            return usage();
        const auto value = [&] { return std::string(argv[++i]); };
        if (flag == "--size")
        {
            const std::string size = value();
            const auto x = size.find('x');
            if (x == std::string::npos)
                return usage();
            width = std::stof(size.substr(0, x));
            height = std::stof(size.substr(x + 1));
        }
        else if (flag == "--scale")
            scale = std::stof(value());
        else if (flag == "--seconds")
            limit = std::stod(value());
        else if (flag == "--eval")
            expression = value();
        else if (flag == "--backend")
        {
            backend = backendNamed(value());
            if (! backend)
                return usage();
        }
        else if (flag == "--software")
            software = true;
        else if (flag == "--json")
            jsonPath = value();
        else if (flag == "--time-native-calls")
            timeNativeCalls = true;
        else
            return usage();
    }
    const double runSeconds = limit.value_or(expression.empty() ? 10 : 600);
    const gpu::DevicePolicy policy = software ? gpu::DevicePolicy::AllowSoftware : gpu::DevicePolicy::HardwareOnly;

    std::string why;
    std::shared_ptr<gpu::Device> device;
    if (backend)
        device = gpu::Device::create({ .policy = policy, .backend = *backend }, &why);
    else
    {
        // The editor's device; where there is no GPU presentation (Linux), the
        // device a plugin's WebGL would make for itself.
        device = render::GpuCompositor::createDevice(software, &why);
        if (device == nullptr)
            device = gpu::Device::create({ .policy = policy }, &why);
#if defined(__linux__)
        // A development machine without Vulkan: ANGLE over the system's OpenGL.
        if (device == nullptr)
            device = gpu::Device::create({ .policy = policy, .backend = gpu::Backend::OpenGL }, &why);
#endif
    }
    if (device == nullptr)
    {
        std::cerr << "no GPU device: " << why << " (try --software)\n";
        return 1;
    }
    std::cerr << "device: " << gpu::name(device->info().backend) << ", " << device->info().renderer << "\n";

    RuntimeHost::Options options;
    options.resources = std::make_shared<platform::DirectoryResources>(directory);
    options.entry = "/bundle.js";
    options.gpuDevice = device;
    options.allowSoftwareGpu = software;
    options.runtime.timeNativeCalls = timeNativeCalls;
    options.runtime.log = [](js::LogLevel, std::string_view message) { std::cerr << message << "\n"; };
    RuntimeHost host(std::move(options));
    host.surface().setSize({ width, height });
    host.surface().setScale(scale);
    gpu::OffscreenCompositor compositor(device, 0xFF000000);
    const render::Capabilities capabilities = compositor.capabilities();

    const auto started = Clock::now();
    const auto elapsed = [&] { return std::chrono::duration<double>(Clock::now() - started).count(); };
    Phase all;
    std::vector<Phase> phases;
    bool measuring = false;
    auto previous = Clock::now();
    RuntimeHost::Statistics previousStatistics = host.statistics();
    const auto currentPhase = [&]
    {
        auto phase = host.context().evaluateScript("typeof soundorRunUiPhase === 'string' ? soundorRunUiPhase : ''");
        return phase && phase.value().isString() ? phase.value().asString() : std::string();
    };
    // The phases a tick counts in: the total, and the named one, if any.
    const auto phasesOf = [&](const std::string& name)
    {
        std::vector<Phase*> counted { &all };
        if (! name.empty())
        {
            auto named = std::ranges::find(phases, name, &Phase::name);
            if (named == phases.end())
                named = phases.insert(phases.end(), Phase { name, {} });
            counted.push_back(&*named);
        }
        return counted;
    };
    const auto frame = [&]
    {
        // The phase the frame's JavaScript runs in, set by an earlier frame.
        const std::string phase = measuring ? currentPhase() : std::string();
        const auto begin = Clock::now();
        host.tick();
        const auto ticked = Clock::now();
        const bool renders = host.needsRender();
        if (measuring)
            for (Phase* counted : phasesOf(phase))
            {
                ++counted->ticks;
                if (! renders)
                {
                    ++counted->idleTicks;
                    counted->idleTickMs += milliseconds(begin, ticked);
                }
            }
        if (! renders)
            return;
        const render::Frame& made = host.frame(capabilities);
        const auto built = Clock::now();
        compositor.composite(made);
        const auto composited = Clock::now();
        const render::CompositorStatistics& composition = compositor.statistics();
        Sample sample {
            .frame = milliseconds(previous, composited),
            .tick = milliseconds(begin, ticked),
            .build = milliseconds(ticked, built),
            .composite = milliseconds(built, composited),
            .layersRasterized = made.statistics.layersRasterized,
            .pixelsRasterized = made.statistics.pixelsRasterized,
            .gpuReadbacks = made.statistics.gpuReadbacks,
            .bytesUploaded = composition.bytesUploaded,
            .textureAllocations = composition.textureAllocations,
            .compositorDrawCalls = composition.drawCalls,
        };
        // Since the previous frame too, ticks that rendered nothing included.
        const RuntimeHost::Statistics statistics = host.statistics();
        difference(previousStatistics, statistics, sample);
        previousStatistics = statistics;
        previous = composited;
        if (! measuring)
            return;
        for (Phase* counted : phasesOf(phase))
            counted->samples.push_back(sample);
    };

    // The UI starts (and settles its first frames) before it is measured.
    while (elapsed() < 1)
        frame();
    measuring = true;
    previous = Clock::now();
    previousStatistics = host.statistics();
    int status = 0;
    std::string outcome = "ok";
    std::string value = "null";
    if (! expression.empty())
    {
        auto pending = host.context().evaluateScript(
            "globalThis.__soundorRun = { done: false };"
            "Promise.resolve("
            + expression
            + ").then("
              "(value) => { __soundorRun = { done: true, value: JSON.stringify(value, null, 2) }; },"
              "(error) => { __soundorRun = { done: true, error: String(error) }; });");
        if (! pending)
        {
            std::cerr << "--eval failed: " << pending.error().toString() << "\n";
            return 1;
        }
        while (elapsed() < runSeconds && ! host.context().evaluateScript("__soundorRun.done").value().asBoolean())
            frame();
        const auto error = host.context().evaluateScript("__soundorRun.error ?? ''").value().asString();
        if (! error.empty())
        {
            std::cerr << "--eval rejected: " << error << "\n";
            status = 1;
            outcome = "rejected";
        }
        else if (! host.context().evaluateScript("__soundorRun.done").value().asBoolean())
        {
            std::cerr << "--eval did not settle within " << runSeconds << " s (--seconds)\n";
            status = 1;
            outcome = "timeout";
        }
        else
        {
            const auto settled = host.context().evaluateScript("__soundorRun.value ?? 'null'").value().asString();
            value = settled;
            std::cout << settled << "\n";
        }
    }
    else
        while (elapsed() < runSeconds)
            frame();

    for (const Phase& phase : phases)
        describe(phase);
    describe(all);

    if (! jsonPath.empty())
    {
        const gpu::DeviceInfo& info = device->info();
        std::string report = "{\n";
        report += R"(  "device": { "backend": )" + jsonString(gpu::name(info.backend))
                  + ", \"renderer\": " + jsonString(info.renderer) + ", \"vendor\": " + jsonString(info.vendor)
                  + ", \"software\": " + (info.software ? "true" : "false") + " },\n";
        report += "  \"size\": [" + number(width) + ", " + number(height) + "], \"scale\": " + number(scale) + ",\n";
        report += "  \"outcome\": " + jsonString(outcome) + ",\n";
        report += "  \"total\": " + json(all) + ",\n";
        report += "  \"phases\": [";
        for (std::size_t i = 0; i < phases.size(); ++i)
            report += std::string(i == 0 ? "\n    " : ",\n    ") + json(phases[i]);
        report += phases.empty() ? "],\n" : "\n  ],\n";
        report += "  \"value\": " + value + "\n}\n";
        std::ofstream file(jsonPath, std::ios::binary);
        file << report;
        if (! file)
        {
            std::cerr << "could not write " << jsonPath << "\n";
            return 1;
        }
    }
    return status;
}
