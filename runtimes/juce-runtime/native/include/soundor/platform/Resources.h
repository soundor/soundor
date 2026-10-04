#pragma once

// Files a plugin ships with its UI: the JavaScript bundle and its assets.

#include <soundor/Config.h>
#include <soundor/js/ModuleLoader.h>

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    // Read-only files by relative path ("bundle.js", "assets/9f86d0.png").
    // Returned bytes stay valid as long as the Resources object.
    class Resources
    {
    public:
        virtual ~Resources() = default;
        [[nodiscard]] virtual std::optional<std::span<const std::uint8_t>> find(std::string_view path) const = 0;
    };

    // Resources compiled into the binary (see soundor_embed_directory()).
    struct EmbeddedFile
    {
        std::string_view path;
        std::span<const std::uint8_t> data;
    };

    class EmbeddedResources final : public Resources
    {
    public:
        explicit EmbeddedResources(std::span<const EmbeddedFile> embedded) : files(embedded) {}

        [[nodiscard]] std::optional<std::span<const std::uint8_t>> find(std::string_view path) const override;

    private:
        std::span<const EmbeddedFile> files;
    };

    // Resources read from a directory (development builds). Files are read
    // once and cached for the object's lifetime.
    class DirectoryResources final : public Resources
    {
    public:
        explicit DirectoryResources(std::filesystem::path directory);
        ~DirectoryResources() override;

        DirectoryResources(const DirectoryResources&) = delete;
        DirectoryResources& operator=(const DirectoryResources&) = delete;

        [[nodiscard]] std::optional<std::span<const std::uint8_t>> find(std::string_view path) const override;

    private:
        struct Cache;
        std::filesystem::path root;
        std::unique_ptr<Cache> cache;
    };

    // Serves JavaScript modules from Resources: module "/bundle.js" is the
    // resource "bundle.js". Relative imports resolve like MemoryModuleLoader;
    // bare specifiers are rejected (the bundle has already inlined packages).
    class ResourceModuleLoader final : public js::ModuleLoader
    {
    public:
        explicit ResourceModuleLoader(std::shared_ptr<const Resources> provided);

        [[nodiscard]] js::Result<std::string> resolve(std::string_view specifier, std::string_view referrer) override;
        [[nodiscard]] js::Result<std::string> load(std::string_view name) override;

    private:
        std::shared_ptr<const Resources> resources;
        js::MemoryModuleLoader paths; // reused for its path resolution rules
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
