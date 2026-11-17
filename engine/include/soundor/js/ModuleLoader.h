#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/js/Error.h>

#include <cstdint>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    // Supplies JavaScript modules to a Context.
    //
    // Soundor owns module resolution: the engine never touches the filesystem on
    // its own. `soundor:*` specifiers are reserved for runtime-provided native
    // modules and are resolved by the Context itself, before a loader is
    // consulted. Everything else goes through the loader; a Context without one
    // can only import `soundor:*` modules.
    //
    // Loaders are called on the runtime's owning thread, synchronously, while
    // the engine links a module graph.
    class ModuleLoader
    {
    public:
        virtual ~ModuleLoader() = default;

        // Maps `specifier`, as written in the module named `referrer`, to the
        // canonical name of the module to load. Failing rejects the import.
        [[nodiscard]] virtual Result<std::string> resolve(std::string_view specifier, std::string_view referrer) = 0;

        // Returns the JavaScript source of the module with canonical `name`.
        [[nodiscard]] virtual Result<std::string> load(std::string_view name) = 0;
        // The module's bytecode, precompiled by the plugin's own build
        // (soundor_compile_js), when there is some: it is read instead of
        // the source. Only for bytecode from that build: the engine does not
        // defend against hostile bytecode. The bytes stay valid as long as
        // the loader. Default: none.
        [[nodiscard]] virtual std::optional<std::span<const std::uint8_t>> loadBytecode(std::string_view name)
        {
            (void)name;
            return std::nullopt;
        }
    };

    // A ModuleLoader over an in-memory set of named sources — the shape of a
    // bundled plugin, where the build has already produced every module.
    //
    // Names are absolute, slash-separated paths ("/app/main.js"). Relative
    // specifiers ("./x.js", "../y.js") resolve against the importing module;
    // bare specifiers ("react") are rejected, because npm packages are bundled
    // at build time and never resolved by the runtime.
    class MemoryModuleLoader final : public ModuleLoader
    {
    public:
        // Adds or replaces a module. `name` is normalised to an absolute path.
        void add(std::string_view name, std::string source);

        [[nodiscard]] Result<std::string> resolve(std::string_view specifier, std::string_view referrer) override;
        [[nodiscard]] Result<std::string> load(std::string_view name) override;

    private:
        std::map<std::string, std::string, std::less<>> modules;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
