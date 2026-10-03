#pragma once

// Private to soundor_runtime: the native functions behind the Web platform
// layer, all exported by the internal module `soundor:internal/platform`.

#include "web/WebState.h"

#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    struct NativeFunction
    {
        const char* name;
        JSCFunction* call;
        int length;
    };

    // Every function `soundor:internal/platform` exports, and the export names
    // (the functions plus constants).
    [[nodiscard]] const std::vector<NativeFunction>& nativeFunctions();
    [[nodiscard]] std::vector<std::string> platformExports();

    // Per feature (one source file each).
    [[nodiscard]] std::vector<NativeFunction> encodingFunctions();
    [[nodiscard]] std::vector<NativeFunction> randomFunctions();
    [[nodiscard]] std::vector<NativeFunction> urlFunctions();
    [[nodiscard]] std::vector<NativeFunction> httpFunctions();
    [[nodiscard]] std::vector<NativeFunction> fileFunctions();
    [[nodiscard]] std::vector<NativeFunction> hostFunctions();

    // The public soundor:* modules this layer provides (JavaScript sources).
    struct PublicModule
    {
        const char* name;
        const std::string_view* source;
    };
    [[nodiscard]] std::span<const PublicModule> publicModules();

    // Delivers soundor:host changes since the last tick (Host.cpp).
    void dispatchHostChanges(JSContext* ctx, State& state);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
