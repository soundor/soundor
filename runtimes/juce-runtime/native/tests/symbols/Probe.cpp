// A stand-in for a plugin binary: links the whole runtime (the engine, the Web
// layer, layout), exports one symbol.

#include <soundor/runtime/RuntimeHost.h>

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
                                      "const box = createView({ width: 42, height: 10 }); root.appendChild(box);"
                                      "globalThis.width = box.layout.width;",
                                      "/probe.js");
    auto width = host.context().evaluateScript("width");
    return result && width ? static_cast<int>(width.value().asNumber()) : -1;
}
