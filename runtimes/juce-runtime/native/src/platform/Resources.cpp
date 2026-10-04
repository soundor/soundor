#include <soundor/platform/Resources.h>

#include <fstream>
#include <map>
#include <mutex>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        // "bundle.js", "/bundle.js" and "./bundle.js" all name one resource.
        std::string_view relative(std::string_view path)
        {
            while (path.starts_with('/') || path.starts_with("./"))
                path.remove_prefix(path.starts_with('/') ? 1 : 2);
            return path;
        }

        bool escapes(std::string_view path)
        {
            return path.find("..") != std::string_view::npos || path.find('\\') != std::string_view::npos
                   || path.find(':') != std::string_view::npos;
        }
    } // namespace

    std::optional<std::span<const std::uint8_t>> EmbeddedResources::find(std::string_view path) const
    {
        const auto wanted = relative(path);
        for (const auto& file : files)
            if (file.path == wanted)
                return file.data;
        return std::nullopt;
    }

    struct DirectoryResources::Cache
    {
        std::mutex mutex;
        std::map<std::string, std::vector<std::uint8_t>, std::less<>> files;
    };

    DirectoryResources::DirectoryResources(std::filesystem::path directory)
        : root(std::move(directory)), cache(std::make_unique<Cache>())
    {
    }

    DirectoryResources::~DirectoryResources() = default;

    std::optional<std::span<const std::uint8_t>> DirectoryResources::find(std::string_view path) const
    {
        const auto wanted = relative(path);
        if (wanted.empty() || escapes(wanted))
            return std::nullopt;
        const std::lock_guard lock(cache->mutex);
        if (const auto it = cache->files.find(wanted); it != cache->files.end())
            return std::span<const std::uint8_t>(it->second);
        std::ifstream in(root / std::filesystem::path(std::u8string(wanted.begin(), wanted.end())), std::ios::binary);
        if (! in)
            return std::nullopt;
        std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        const auto [it, inserted] = cache->files.emplace(std::string(wanted), std::move(bytes));
        (void)inserted;
        return std::span<const std::uint8_t>(it->second);
    }

    ResourceModuleLoader::ResourceModuleLoader(std::shared_ptr<const Resources> provided)
        : resources(std::move(provided))
    {
    }

    js::Result<std::string> ResourceModuleLoader::resolve(std::string_view specifier, std::string_view referrer)
    {
        return paths.resolve(specifier, referrer);
    }

    js::Result<std::string> ResourceModuleLoader::load(std::string_view name)
    {
        const auto bytes = resources->find(name);
        if (! bytes)
            return js::Error { "TypeError", "Cannot find module '" + std::string(name) + "'", {} };
        return std::string(bytes->begin(), bytes->end());
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
