#pragma once

// Private to soundor_runtime: the native functions behind the Web platform
// layer, all exported by the internal module `soundor:internal/platform`.

#include "modules/Embedded.h"
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
        js::bind::NativeFunction call;
        unsigned length;
    };

    // Every function `soundor:internal/platform` exports (besides constants).
    [[nodiscard]] const std::vector<NativeFunction>& nativeFunctions();

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
        const embedded::ModuleCode* code;
    };
    [[nodiscard]] std::span<const PublicModule> publicModules();

    // Delivers soundor:host changes since the last tick (Host.cpp).
    void dispatchHostChanges(js::bind::ContextState& context, State& state);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
