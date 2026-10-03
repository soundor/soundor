// A stand-in for a plugin binary: links the whole runtime, exports one symbol.

#include <soundor/js/Context.h>

#if defined(__GNUC__) || defined(__clang__)
    #define SOUNDOR_PROBE_EXPORT extern "C" __attribute__((visibility("default")))
#else
    #define SOUNDOR_PROBE_EXPORT extern "C"
#endif

SOUNDOR_PROBE_EXPORT int soundor_probe_entry()
{
    soundor::js::Runtime runtime;
    soundor::js::Context context(runtime);
    auto result = context.evaluateScript("6 * 7");
    return result ? static_cast<int>(result.value().asNumber()) : -1;
}
