// A stand-in for a plugin binary: links the whole runtime (the engine, the Web
// layer, layout, the GPU), exports one symbol.

#include <soundor/a11y/Platform.h>
#include <soundor/runtime/RuntimeHost.h>

#if SOUNDOR_HAS_GPU
    #include "gpu/Context.h"
#endif

#include <cstdint>
#include <vector>

#if defined(__GNUC__) || defined(__clang__)
    #define SOUNDOR_PROBE_EXPORT extern "C" __attribute__((visibility("default")))
#else
    #define SOUNDOR_PROBE_EXPORT extern "C"
#endif

SOUNDOR_PROBE_EXPORT int soundor_probe_entry()
{
    soundor::RuntimeHost host({});
    host.surface().setSize({ 100, 100 });
    auto result =
        host.context().evaluateModule("import { root, createView } from 'soundor:ui';"
                                      "const box = createView({ width: 42, height: 10, backgroundColor: 'red' });"
                                      "root.appendChild(box); globalThis.width = box.layout.width;",
                                      "/probe.js");
    std::vector<std::uint32_t> pixels(std::size_t { 100 } * 100);
    host.render({ pixels.data(), 100, 100, std::size_t { 100 } * 4 });
    // Links the platform's accessibility (AccessKit) in, for the export check.
    auto accessibility = soundor::a11y::createPlatformAccessibility({});
    if (accessibility != nullptr)
        accessibility->tick(host);
#if SOUNDOR_HAS_GPU
    // Links ANGLE in, for the export and Objective-C checks.
    if (auto device = soundor::gpu::Device::create({ .policy = soundor::gpu::DevicePolicy::AllowSoftware }))
        (void)soundor::gpu::Context::create(device, { .webgl = true });
#endif
    auto width = host.context().evaluateScript("width");
    return result && width && pixels[0] != 0 ? static_cast<int>(width.value().asNumber()) : -1;
}
