// soundor_run_ui: runs a plugin UI bundle headless, on the GPU, the way the
// generated editor would, and reports what its frames cost. For benchmarks
// (examples/three) and for looking at a UI without building a plugin.
//
//   soundor_run_ui <ui directory> [--size 800x600] [--scale 1] [--seconds 10]
//                  [--eval <expression>] [--software]
//
// <ui directory> is a built bundle (.soundor/ui/production after
// `soundor build web`). With --eval, the expression is evaluated once the UI
// has started; if it is a promise, the run lasts until it settles (or
// --seconds pass) and its value is printed as JSON. On Linux without Vulkan,
// it runs on ANGLE's OpenGL backend. Frames are made and
// composited as fast as they come, on an offscreen GPU compositor sharing
// the UI's device, so WebGL is composited without copies, as in a plugin.
// What the UI logs goes to stderr.

#include "gpu/Device.h"
#include "gpu/OffscreenCompositor.h"

#include <soundor/platform/Resources.h>
#include <soundor/render/GpuCompositor.h>
#include <soundor/runtime/RuntimeHost.h>

#include <chrono>
#include <cstdio>
#include <iostream>
#include <string>
#include <string_view>

using namespace soundor;

namespace
{
    int usage()
    {
        std::cerr << "usage: soundor_run_ui <ui directory> [--size WxH] [--scale S] [--seconds N] [--eval EXPR] "
                     "[--software]\n";
        return 2;
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
    double seconds = 10;
    std::string expression;
    bool software = false;
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
            seconds = std::stod(value());
        else if (flag == "--eval")
            expression = value();
        else if (flag == "--software")
            software = true;
        else
            return usage();
    }

    // The editor's device; where there is no GPU presentation (Linux), the
    // device a plugin's WebGL would make for itself.
    std::string why;
    auto device = render::GpuCompositor::createDevice(software, &why);
    if (device == nullptr)
        device = gpu::Device::create(
            { .policy = software ? gpu::DevicePolicy::AllowSoftware : gpu::DevicePolicy::HardwareOnly }, &why);
#if defined(__linux__)
    // A development machine without Vulkan: ANGLE over the system's OpenGL.
    if (device == nullptr)
        device = gpu::Device::create(
            { .policy = software ? gpu::DevicePolicy::AllowSoftware : gpu::DevicePolicy::HardwareOnly,
              .backend = gpu::Backend::OpenGL },
            &why);
#endif
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

    const auto started = std::chrono::steady_clock::now();
    const auto elapsed = [&]
    { return std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count(); };
    long long frames = 0;
    long long readbacks = 0;
    long long rasterized = 0;
    long long uploaded = 0;
    const auto frame = [&]
    {
        host.tick();
        if (! host.needsRender())
            return;
        const render::Frame& made = host.frame(capabilities);
        compositor.composite(made);
        ++frames;
        readbacks += made.statistics.gpuReadbacks;
        rasterized += made.statistics.layersRasterized;
        uploaded += compositor.statistics().bytesUploaded;
    };

    // The UI starts (and settles its first frames) before the expression.
    while (elapsed() < 1)
        frame();
    int status = 0;
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
        while (elapsed() < seconds && ! host.context().evaluateScript("__soundorRun.done").value().asBoolean())
            frame();
        const auto error = host.context().evaluateScript("__soundorRun.error ?? ''").value().asString();
        if (! error.empty())
        {
            std::cerr << "--eval rejected: " << error << "\n";
            status = 1;
        }
        else if (! host.context().evaluateScript("__soundorRun.done").value().asBoolean())
        {
            std::cerr << "--eval did not settle within " << seconds << " s\n";
            status = 1;
        }
        else
            std::cout << host.context().evaluateScript("__soundorRun.value ?? 'undefined'").value().asString() << "\n";
    }
    else
        while (elapsed() < seconds)
            frame();

    const double total = elapsed();
    std::cerr << frames << " frames in " << total << " s (" << static_cast<double>(frames) / total << " fps); "
              << readbacks << " GPU read-backs, " << rasterized << " CPU layers rasterized, " << uploaded
              << " bytes uploaded\n";
    return status;
}
