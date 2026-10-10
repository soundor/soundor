// soundor_run_ui: runs a plugin UI bundle headless, on the GPU, the way the
// generated editor would, and reports what its frames cost. For benchmarks
// (examples/three) and for looking at a UI without building a plugin.
//
//   soundor_run_ui <ui directory> [--size 800x600] [--scale 1] [--seconds N]
//                  [--eval <expression>] [--backend <name>] [--software]
//                  [--json <file>]
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
// --json writes the report (device, value, totals, phases) to a file.

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
                     "[--backend vulkan|opengl|metal|d3d11] [--software] [--json FILE]\n";
        return 2;
    }

    double milliseconds(Clock::time_point from, Clock::time_point to)
    {
        return std::chrono::duration<double, std::milli>(to - from).count();
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
    };

    struct Phase
    {
        std::string name;
        std::vector<Sample> samples;
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
                  << " CPU layers rasterized, " << total(s, &Sample::bytesUploaded) << " bytes uploaded\n";
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
    for (int i = 2; i < argc; ++i)
    {
        const std::string_view flag = argv[i];
        // Every flag but --software takes a value.
        if (flag != "--software" && i + 1 >= argc)
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
    const auto currentPhase = [&]
    {
        auto phase = host.context().evaluateScript("typeof soundorRunUiPhase === 'string' ? soundorRunUiPhase : ''");
        return phase && phase.value().isString() ? phase.value().asString() : std::string();
    };
    const auto frame = [&]
    {
        // The phase the frame's JavaScript runs in, set by an earlier frame.
        const std::string phase = measuring ? currentPhase() : std::string();
        const auto begin = Clock::now();
        host.tick();
        const auto ticked = Clock::now();
        if (! host.needsRender())
            return;
        const render::Frame& made = host.frame(capabilities);
        const auto built = Clock::now();
        compositor.composite(made);
        const auto composited = Clock::now();
        const render::CompositorStatistics& composition = compositor.statistics();
        const Sample sample {
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
        previous = composited;
        if (! measuring)
            return;
        all.samples.push_back(sample);
        if (phase.empty())
            return;
        auto named = std::ranges::find(phases, phase, &Phase::name);
        if (named == phases.end())
            named = phases.insert(phases.end(), Phase { phase, {} });
        named->samples.push_back(sample);
    };

    // The UI starts (and settles its first frames) before it is measured.
    while (elapsed() < 1)
        frame();
    measuring = true;
    previous = Clock::now();
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
