#include "Bundle.h"

#include "Paths.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>

namespace soundor::vst3host
{
    namespace fs = std::filesystem;

    std::string hostArchitecture()
    {
#if defined(__aarch64__) || defined(_M_ARM64)
        return "arm64";
#elif defined(__x86_64__) || defined(_M_X64)
        return "x64";
#elif defined(__i386__) || defined(_M_IX86)
        return "x86";
#else
        return "unknown";
#endif
    }

    namespace
    {
        uint32_t le32(const uint8_t* p)
        {
            return p[0] | (p[1] << 8U) | (p[2] << 16U) | (static_cast<uint32_t>(p[3]) << 24U);
        }
        uint32_t be32(const uint8_t* p)
        {
            return (static_cast<uint32_t>(p[0]) << 24U) | (p[1] << 16U) | (p[2] << 8U) | p[3];
        }
        uint16_t le16(const uint8_t* p)
        {
            return static_cast<uint16_t>(p[0] | (p[1] << 8U));
        }

        std::string machOCpu(uint32_t cpu)
        {
            switch (cpu)
            {
                case 0x01000007:
                    return "x64";
                case 0x0100000C:
                    return "arm64";
                case 0x00000007:
                    return "x86";
                case 0x0000000C:
                    return "arm";
                default:
                    return "unknown";
            }
        }
    } // namespace

    std::vector<std::string> binaryArchitectures(const std::string& path)
    {
        std::ifstream file(toPath(path), std::ios::binary);
        std::array<uint8_t, 4096> head {};
        file.read(reinterpret_cast<char*>(head.data()), head.size());
        const auto size = static_cast<size_t>(file.gcount());
        if (size < 64)
            return {};
        const uint8_t* p = head.data();

        // ELF: e_machine.
        if (p[0] == 0x7F && p[1] == 'E' && p[2] == 'L' && p[3] == 'F')
        {
            switch (le16(p + 18))
            {
                case 0x3E:
                    return { "x64" };
                case 0xB7:
                    return { "arm64" };
                case 0x03:
                    return { "x86" };
                case 0x28:
                    return { "arm" };
                default:
                    return { "unknown" };
            }
        }
        // Universal Mach-O: big-endian fat header, then one entry per slice.
        if (be32(p) == 0xCAFEBABE || be32(p) == 0xCAFEBABF)
        {
            const bool wide = be32(p) == 0xCAFEBABF;
            const uint32_t count = be32(p + 4);
            const size_t entry = wide ? 32 : 20;
            std::vector<std::string> result;
            for (uint32_t i = 0; i < count && 8 + (i + 1) * entry <= size; ++i)
                result.push_back(machOCpu(be32(p + 8 + i * entry)));
            return result;
        }
        // Thin 64-bit or 32-bit Mach-O, little-endian.
        if (le32(p) == 0xFEEDFACF || le32(p) == 0xFEEDFACE)
            return { machOCpu(le32(p + 4)) };
        // PE: the COFF header's Machine.
        if (p[0] == 'M' && p[1] == 'Z')
        {
            const uint32_t offset = le32(p + 0x3C);
            if (offset + 6 <= size && p[offset] == 'P' && p[offset + 1] == 'E' && p[offset + 2] == 0
                && p[offset + 3] == 0)
            {
                switch (le16(p + offset + 4))
                {
                    case 0x8664:
                        return { "x64" };
                    case 0xAA64:
                        return { "arm64" };
                    case 0xA641: // ARM64EC/ARM64X
                        return { "arm64", "x64" };
                    case 0x014C:
                        return { "x86" };
                    default:
                        return { "unknown" };
                }
            }
        }
        return {};
    }

    namespace
    {
        std::string joined(const std::vector<std::string>& items)
        {
            std::string out;
            for (const auto& item : items)
                out += (out.empty() ? "" : ", ") + item;
            return out.empty() ? "none" : out;
        }

        // Linux and Windows bundles keep one binary per architecture in
        // Contents/<arch>-<os>/; macOS keeps one (possibly universal) binary.
        std::string folderArchitecture(const std::string& name)
        {
            if (name.starts_with("x86_64-"))
                return "x64";
            if (name.starts_with("aarch64-") || name.starts_with("arm64-") || name.starts_with("arm64ec-")
                || name.starts_with("arm64x-"))
                return "arm64";
            if (name.starts_with("i386-") || name.starts_with("x86-"))
                return "x86";
            if (name.starts_with("armv7l-") || name.starts_with("armv8l-"))
                return "arm";
            return "unknown";
        }

        BundleCheck fail(std::string code, std::string message)
        {
            BundleCheck check;
            check.code = std::move(code);
            check.message = std::move(message);
            return check;
        }
    } // namespace

    BundleCheck checkBundle(const std::string& path)
    {
        std::error_code error;
        const fs::path bundle = toPath(path);
        if (! fs::exists(bundle, error))
            return fail("plugin-not-found", "no VST3 plugin exists at " + path);
        if (bundle.extension() != ".vst3")
            return fail("invalid-bundle", path + " is not a VST3 plugin (a .vst3 bundle)");

        const std::string arch = hostArchitecture();
        BundleCheck check;
#if defined(_WIN32)
        if (fs::is_regular_file(bundle, error))
        {
            // A single-file plugin (VST 3.6.x layout).
            check.binary = path;
            check.architectures = binaryArchitectures(path);
        }
#endif
        if (check.binary.empty())
        {
            const fs::path contents = bundle / "Contents";
            if (! fs::is_directory(contents, error))
                return fail("invalid-bundle", path + " has no Contents directory");
#if defined(__APPLE__)
            const fs::path macos = contents / "MacOS";
            if (fs::is_directory(macos, error))
                for (const auto& entry : fs::directory_iterator(macos, error))
                    if (entry.is_regular_file(error))
                    {
                        check.binary = fromPath(entry.path());
                        check.architectures = binaryArchitectures(check.binary);
                        break;
                    }
            if (check.binary.empty())
                return fail("invalid-bundle", path + " has no binary in Contents/MacOS");
#else
    #if defined(_WIN32)
            const std::string suffix = "-win";
            const std::string extension = ".vst3";
            const std::string wanted = arch == "arm64" ? "arm64-win" : arch == "x86" ? "x86-win" : "x86_64-win";
    #else
            const std::string suffix = "-linux";
            const std::string extension = ".so";
            const std::string wanted = arch == "arm64" ? "aarch64-linux"
                                       : arch == "x86" ? "i386-linux"
                                                       : "x86_64-linux";
    #endif
            for (const auto& entry : fs::directory_iterator(contents, error))
            {
                const std::string name = fromPath(entry.path().filename());
                if (! entry.is_directory(error) || ! name.ends_with(suffix))
                    continue;
                check.architectures.push_back(folderArchitecture(name));
                if (name != wanted)
                    continue;
                const fs::path binary = entry.path() / toPath(fromPath(bundle.stem()) + extension);
                if (fs::exists(binary, error))
                    check.binary = fromPath(binary);
            }
            std::sort(check.architectures.begin(), check.architectures.end());
            if (check.binary.empty())
            {
                if (check.architectures.empty())
                    return fail("invalid-bundle", path + " has no Contents/<architecture>" + suffix + " binary");
                auto result = fail("incompatible-architecture", path + " has no " + arch + " binary (Contents/" + wanted
                                                                    + "/" + fromPath(bundle.stem()) + extension
                                                                    + "); it provides " + joined(check.architectures)
                                                                    + ", and this host runs as " + arch);
                result.architectures = check.architectures;
                return result;
            }
            // The folder may be misnamed: trust the binary's header.
            const auto actual = binaryArchitectures(check.binary);
            if (! actual.empty())
                check.architectures = actual;
#endif
        }

        if (! check.architectures.empty()
            && std::find(check.architectures.begin(), check.architectures.end(), arch) == check.architectures.end())
        {
            auto result = fail("incompatible-architecture", check.binary + " contains " + joined(check.architectures)
                                                                + " code, and this host runs as " + arch);
            result.architectures = check.architectures;
            return result;
        }
        return check;
    }
} // namespace soundor::vst3host
