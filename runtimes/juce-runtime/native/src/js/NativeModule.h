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
        // A module implemented in C++. Its export names are declared up front
        // (ES modules are statically linked); `initialize` fills them in when
        // the module is first imported and returns false after throwing.
        struct NativeModule
        {
            std::vector<std::string> exports;
            std::function<bool(JSContext*, JSModuleDef*)> initialize;
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
    } // namespace detail

    // Makes `name` (which must start with "soundor:") importable in `context`.
    // Register before evaluating code that imports it.
    void registerNativeModule(Context& context, std::string name, detail::NativeModule module);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
