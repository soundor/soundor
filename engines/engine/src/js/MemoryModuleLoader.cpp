#include <soundor/js/ModuleLoader.h>

#include <algorithm>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace
    {
        // Collapses "." and ".." segments into an absolute "/a/b" path. Returns
        // false when ".." would climb above the root.
        bool normalisePath(std::string_view path, std::string& out)
        {
            std::vector<std::string_view> segments;
            std::size_t start = 0;
            while (start <= path.size())
            {
                const std::size_t end = std::min(path.find('/', start), path.size());
                const std::string_view segment = path.substr(start, end - start);
                if (segment == "..")
                {
                    if (segments.empty())
                        return false;
                    segments.pop_back();
                }
                else if (! segment.empty() && segment != ".")
                {
                    segments.push_back(segment);
                }
                start = end + 1;
            }

            out.clear();
            for (const auto segment : segments)
            {
                out += '/';
                out += segment;
            }
            if (out.empty())
                out = "/";
            return true;
        }

        std::string_view directoryOf(std::string_view name)
        {
            const std::size_t slash = name.rfind('/');
            return slash == std::string_view::npos ? std::string_view {} : name.substr(0, slash);
        }

        Error moduleError(std::string message)
        {
            return Error { "TypeError", std::move(message), {} };
        }
    } // namespace

    void MemoryModuleLoader::add(std::string_view name, std::string source)
    {
        std::string normalised;
        if (! normalisePath(name, normalised))
            normalised = std::string(name);
        modules.insert_or_assign(std::move(normalised), std::move(source));
    }

    Result<std::string> MemoryModuleLoader::resolve(std::string_view specifier, std::string_view referrer)
    {
        std::string joined;
        if (specifier.starts_with("./") || specifier.starts_with("../"))
        {
            joined = std::string(directoryOf(referrer));
            joined += '/';
            joined += specifier;
        }
        else if (specifier.starts_with('/'))
        {
            joined = std::string(specifier);
        }
        else
        {
            return moduleError("Cannot resolve bare module specifier '" + std::string(specifier)
                               + "'; packages are bundled at build time, not resolved at runtime");
        }

        std::string resolved;
        if (! normalisePath(joined, resolved))
            return moduleError("Module specifier '" + std::string(specifier) + "' escapes the module root");
        return resolved;
    }

    Result<std::string> MemoryModuleLoader::load(std::string_view name)
    {
        const auto it = modules.find(name);
        if (it == modules.end())
            return moduleError("Cannot find module '" + std::string(name) + "'");
        return it->second;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
