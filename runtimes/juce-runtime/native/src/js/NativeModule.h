#pragma once

// Private to soundor_runtime: native modules are how Soundor exposes
// `soundor:*` APIs to JavaScript. Generated bindings and built-in modules build
// on this; plugin code never sees it.

#include <soundor/Config.h>

#include <quickjs.h>

#include <functional>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    class Context;

    namespace detail
    {
        // A module provided by the runtime. Either implemented in C++ — its
        // export names declared up front (ES modules are statically linked)
        // and filled in by `initialize`, which returns false after throwing —
        // or, when `source` is set, written in JavaScript embedded in the
        // runtime.
        struct NativeModule
        {
            std::vector<std::string> exports;
            std::function<bool(JSContext*, JSModuleDef*)> initialize;
            std::string_view source;
        };

        class NativeModuleRegistry
        {
        public:
            void add(std::string name, NativeModule module);
            [[nodiscard]] const NativeModule* find(std::string_view name) const;

        private:
            std::map<std::string, NativeModule, std::less<>> modules;
        };

        // The prefix reserved for runtime-provided modules.
        inline constexpr std::string_view nativeModulePrefix = "soundor:";

        [[nodiscard]] inline bool isNativeModuleSpecifier(std::string_view specifier) noexcept
        {
            return specifier.starts_with(nativeModulePrefix);
        }

        // Runtime-private building blocks of the public modules: importable
        // only from runtime-provided modules, never from plugin code.
        inline constexpr std::string_view internalModulePrefix = "soundor:internal/";

        [[nodiscard]] inline bool isInternalModuleSpecifier(std::string_view specifier) noexcept
        {
            return specifier.starts_with(internalModulePrefix);
        }
    } // namespace detail

    // Makes `name` (which must start with "soundor:") importable in `context`.
    // Register before evaluating code that imports it.
    void registerNativeModule(Context& context, std::string name, detail::NativeModule module);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
